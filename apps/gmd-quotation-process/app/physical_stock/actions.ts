"use server";

import {
  listPhysicalStock,
  syncPhysicalStockFromSheet,
  updatePhysicalStockField,
} from "@gmd/physical-stock/server";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { ActionResult, PhysicalStockRow } from "@gmd/physical-stock/types";
import { stockPrisma } from "@/lib/stockPrisma";
import { getOAuthClient } from "@/lib/googleAuth";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import {
  applyPhysicalStockDerivations,
  costForPhysicalStockBom,
  derivePhysicalStockByCodes,
} from "@/lib/gmd_lib/physical-stock-derive";

// Physical stock in this app is public (no auth), as before the move to
// @gmd/physical-stock. Flags are evaluated again inside every action: the UI
// hiding a control is cosmetic, these checks protect the data.

const code = (erp: string | null) => (erp ?? "").trim().toUpperCase();

/** Rows plus per-row BOM ID options from the quotation DB BOM relations. */
export async function load() {
  try {
    const items = await listPhysicalStock();
    const derivations = await derivePhysicalStockByCodes(items.map((i) => code(i.erp_code)));
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) bomIdOptions[item.id] = derivations.get(code(item.erp_code))?.bomIds ?? [];
    return { success: true as const, data: { items, bomIdOptions } };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sheet sync, then derive Cost / BOM ID / major-minor from the quotation DB. */
export async function sync() {
  const res = await syncPhysicalStockFromSheet(getOAuthClient());
  if (res.success) await applyPhysicalStockDerivations();
  return res;
}

export async function updateField(id: string, field: string, value: string | null) {
  return updatePhysicalStockField(id, field, value, editableFieldsFor(await getPhysicalStockFlags()));
}

export async function updateBomId(
  id: string,
  bomId: string | null,
): Promise<ActionResult<Partial<PhysicalStockRow>>> {
  if (!(await getPhysicalStockFlags()).editableColumns.includes("BOM ID")) {
    return { success: false, error: "Not allowed in this app." };
  }
  try {
    const row = await stockPrisma.physicalStock.findUnique({ where: { id }, select: { erp_code: true } });
    if (!row) throw new Error("Physical stock row not found.");

    const value = bomId?.trim() || null;
    const erp = code(row.erp_code);
    const derivation = erp ? (await derivePhysicalStockByCodes([erp])).get(erp) : undefined;
    if (value && derivation && derivation.bomIds.length > 0 && !derivation.bomIds.includes(value)) {
      throw new Error("Selected BOM ID is not in available options.");
    }

    // Cost follows the selected BOM via the DB-maintained FullItem.cost
    // (fallback RawMaterial.cost). Clearing the BOM falls back to the code cost.
    const cost = value ? await costForPhysicalStockBom(erp, value) : (derivation?.maxCost ?? null);

    await stockPrisma.physicalStock.update({ where: { id }, data: { bom_id: value, cost } });
    return { success: true, data: { bom_id: value, cost } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
