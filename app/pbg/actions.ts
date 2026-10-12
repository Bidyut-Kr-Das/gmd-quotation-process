"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncPbgData, updatePbgCell } from "@/lib/pbg/pbg-data";
import { isEditableKey, parseCellInput } from "@/lib/pbg/pbg-cell";
import { normalizePo, pickLatestDateRows } from "@/lib/pbg/supply-history";

export type SyncResult =
  | { ok: true; synced: number; skipped: number; durationMs: number }
  | { ok: false; error: string };

export async function syncPbgDataAction(): Promise<SyncResult> {
  const startedAt = Date.now();
  try {
    const { synced, skipped } = await syncPbgData();
    revalidatePath("/pbg");
    return {
      ok: true,
      synced,
      skipped,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    };
  }
}

export type UpdateCellResult = { ok: true } | { ok: false; error: string };

export async function updatePbgCellAction(
  id: string,
  key: string,
  value: string,
): Promise<UpdateCellResult> {
  try {
    if (!/^\d+$/.test(id)) {
      throw new Error("Invalid row id");
    }
    if (!isEditableKey(key)) {
      throw new Error(`Column "${key}" is not editable`);
    }
    const coerced = parseCellInput(key, value);
    await updatePbgCell(id, key, coerced);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
}

export type SupplyHistoryRow = {
  id: string;
  date: string | null;
  invoiceNo: string | null;
  itemName: string | null;
  partyName: string | null;
  quantity: string | null;
  uom: string | null;
  value: string | null;
};

export type SupplyHistoryResult =
  | {
      ok: true;
      poNumber: string;
      latestDate: string | null;
      rows: SupplyHistoryRow[];
    }
  | { ok: false; error: string };

/**
 * Looks up supply history for a PO number and keeps only the rows sharing the
 * most recent invoice date (all items on that date).
 */
export async function getSupplyHistoryForPoAction(
  poNumber: string,
): Promise<SupplyHistoryResult> {
  try {
    const po = normalizePo(poNumber);
    if (!po) {
      return { ok: true, poNumber: "", latestDate: null, rows: [] };
    }

    let items = await prisma.supplyHistoryItem.findMany({
      where: { partyOrderNo: { equals: po } },
    });
    if (items.length === 0) {
      items = await prisma.supplyHistoryItem.findMany({
        where: { partyOrderNo: { equals: po, mode: "insensitive" } },
      });
    }
    if (items.length === 0) {
      return { ok: true, poNumber: po, latestDate: null, rows: [] };
    }

    const { latestRaw, rows } = pickLatestDateRows(items, (item) => item.date);

    return {
      ok: true,
      poNumber: po,
      latestDate: latestRaw,
      rows: rows.map((item) => ({
        id: item.id,
        date: item.date,
        invoiceNo: item.invoiceNo,
        itemName: item.itemName,
        partyName: item.partyName,
        quantity: item.quantity,
        uom: item.uom,
        value: item.value,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lookup failed",
    };
  }
}
