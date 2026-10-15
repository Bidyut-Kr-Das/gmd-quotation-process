"use server";

import { createHash } from "crypto";
import { stockPrisma } from "@/lib/stockPrisma";
import { fetchPhysicalStockSheet } from "@/lib/gmd_lib/physical-stock-sheet";
import {
  PHYSICAL_COL_INDEX_TO_DB_FIELD,
  PHYSICAL_EDITABLE_FIELDS,
} from "@/lib/gmd_lib/physical-stock-columns";
import {
  applyPhysicalStockDerivations,
  costForPhysicalStockBom,
  derivePhysicalStockByCodes,
} from "@/lib/gmd_lib/physical-stock-derive";
import { computeItemWiseValue } from "@/lib/gmd_lib/physical-stock-value";

export interface FieldUpdateResult {
  id: string;
  field: string;
  value: string | null;
  /** Present when the edit changed `rate_unit`/`available_qty`; item value = rate * qty. */
  item_wise_value?: string;
}

export interface PhysicalStockBomUpdateResult {
  id: string;
  bom_id: string | null;
  cost: string | null;
}

export async function updatePhysicalStockFieldAction(
  id: string,
  field: string,
  value: string | null,
): Promise<FieldUpdateResult> {
  const data: Record<string, string | null> = { [field]: value ?? null };

  // item_wise_value = rate/unit * available qty. Recompute whenever either
  // operand is edited, using the row's value for the other operand.
  let itemWiseValue: string | undefined;
  if (field === "rate_unit" || field === "available_qty") {
    const row = await stockPrisma.physicalStock.findUnique({
      where: { id },
      select: { rate_unit: true, available_qty: true },
    });
    if (row) {
      const rate = field === "rate_unit" ? value : row.rate_unit;
      const available = field === "available_qty" ? value : row.available_qty;
      itemWiseValue = computeItemWiseValue(rate, available);
      data.item_wise_value = itemWiseValue;
    }
  }

  await stockPrisma.physicalStock.update({ where: { id }, data });
  return { id, field, value: value ?? null, item_wise_value: itemWiseValue };
}

export async function updatePhysicalStockBomIdAction(
  id: string,
  bomId: string | null,
): Promise<PhysicalStockBomUpdateResult> {
  const row = await stockPrisma.physicalStock.findUnique({
    where: { id },
    select: { erp_code: true },
  });
  if (!row) throw new Error("Physical stock row not found.");

  const value = bomId?.trim() || null;
  const code = (row.erp_code ?? "").trim().toUpperCase();

  if (value && code) {
    const derivations = await derivePhysicalStockByCodes([code]);
    const d = derivations.get(code);
    if (d && d.bomIds.length > 0 && !d.bomIds.includes(value)) {
      throw new Error("Selected BOM ID is not in available options.");
    }
  }

  // Cost follows the selected BOM via the DB-maintained FullItem.cost
  // (fallback RawMaterial.cost). Clearing the BOM falls back to the code cost.
  let cost: string | null = null;
  if (value) {
    cost = await costForPhysicalStockBom(code, value);
  } else if (code) {
    const derivations = await derivePhysicalStockByCodes([code]);
    cost = derivations.get(code)?.maxCost ?? null;
  }

  await stockPrisma.physicalStock.update({
    where: { id },
    data: { bom_id: value, cost },
  });
  return { id, bom_id: value, cost };
}

export async function recomputePhysicalStockCostBomAction(): Promise<{
  success: boolean;
  updated?: number;
  error?: string;
}> {
  try {
    const { updated } = await applyPhysicalStockDerivations();
    return { success: true, updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Recompute every row's `item_wise_value` as `rate/unit * available qty`
 * (2 decimals). Only changed rows are written. Idempotent.
 */
export async function recomputePhysicalStockItemWiseValueAction(): Promise<{
  success: boolean;
  scanned?: number;
  updated?: number;
  error?: string;
}> {
  try {
    const rows = await stockPrisma.physicalStock.findMany({
      select: {
        id: true,
        rate_unit: true,
        available_qty: true,
        item_wise_value: true,
      },
    });

    let updated = 0;
    const writes: { id: string; item_wise_value: string }[] = [];
    for (const row of rows) {
      const next = computeItemWiseValue(row.rate_unit, row.available_qty);
      if (next === row.item_wise_value) continue;
      writes.push({ id: row.id, item_wise_value: next });
    }

    const chunkSize = 200;
    for (let i = 0; i < writes.length; i += chunkSize) {
      await stockPrisma.$transaction(
        writes
          .slice(i, i + chunkSize)
          .map((w) =>
            stockPrisma.physicalStock.update({
              where: { id: w.id },
              data: { item_wise_value: w.item_wise_value },
            }),
          ),
        { timeout: 120_000, maxWait: 30_000 },
      );
      updated += Math.min(chunkSize, writes.length - i);
    }

    return { success: true, scanned: rows.length, updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function updatePhysicalStockUsdCostAction(
  _id: string,
  _usdCost: string | null,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  return {
    success: false,
    error: "USD cost conversion is not supported for physical stock rows.",
  };
}

// Columns the sheet does not carry and that must never feed the content key:
// derived cost/bom_id are set by the derivation step, form_date is DB-owned, and
// item_wise_value is derived from rate/unit * available qty. Including any of
// them would make an existing row look "new" on every sync and be recreated.
const NON_CONTENT_FIELDS = new Set([
  "cost",
  "bom_id",
  "form_date",
  "item_wise_value",
]);

const CONTENT_FIELDS = Array.from(
  new Set(Object.values(PHYSICAL_COL_INDEX_TO_DB_FIELD)),
).filter((field) => !NON_CONTENT_FIELDS.has(field));

function contentKey(record: Record<string, string | null>): string {
  const o: Record<string, string | null> = {};
  for (const field of CONTENT_FIELDS) {
    if (PHYSICAL_EDITABLE_FIELDS.includes(field)) continue;
    o[field] = record[field] ?? null;
  }
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

export async function syncPhysicalStockFromSheetAction(): Promise<{
  success: boolean;
  created?: number;
  skipped?: number;
  totalRows?: number;
  syncedAt?: string;
  derivedUpdated?: number;
  error?: string;
}> {
  try {
    const rows = await fetchPhysicalStockSheet();

    const existing = await stockPrisma.physicalStock.findMany();
    const byKey = new Map<string, string>();
    for (const row of existing) {
      const key = contentKey(row as unknown as Record<string, string | null>);
      if (!byKey.has(key)) byKey.set(key, row.id);
    }

    const toCreate: Record<string, string | null>[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    for (const sheetRow of rows) {
      const key = contentKey(sheetRow);
      if (seen.has(key) || byKey.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      toCreate.push(sheetRow);
    }

    // item_wise_value = rate/unit * available qty (2 dp), not the sheet's value.
    for (const row of toCreate) {
      row.item_wise_value = computeItemWiseValue(
        row.rate_unit,
        row.available_qty,
      );
    }

    if (toCreate.length > 0) {
      await stockPrisma.physicalStock.createMany({ data: toCreate });
    }

    // Derive Cost / BOM ID from the FullItem + RawMaterial BOM relations.
    const { updated: derivedUpdated } = await applyPhysicalStockDerivations();

    return {
      success: true,
      created: toCreate.length,
      skipped,
      totalRows: rows.length,
      syncedAt: new Date().toISOString(),
      derivedUpdated,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
