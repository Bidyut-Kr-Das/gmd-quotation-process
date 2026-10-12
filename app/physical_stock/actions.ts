"use server";

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { fetchPhysicalStockSheet } from "@/lib/gmd_lib/physical-stock-sheet";
import {
  PHYSICAL_COL_INDEX_TO_DB_FIELD,
  PHYSICAL_EDITABLE_FIELDS,
} from "@/lib/gmd_lib/physical-stock-columns";

export interface FieldUpdateResult {
  id: string;
  field: string;
  value: string | null;
}

export async function updatePhysicalStockFieldAction(
  id: string,
  field: string,
  value: string | null,
): Promise<FieldUpdateResult> {
  const data: Record<string, string | null> = { [field]: value ?? null };
  await prisma.physicalStock.update({ where: { id }, data });
  return { id, field, value: value ?? null };
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

const CONTENT_FIELDS = Array.from(
  new Set(Object.values(PHYSICAL_COL_INDEX_TO_DB_FIELD)),
);

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
  error?: string;
}> {
  try {
    const rows = await fetchPhysicalStockSheet();

    const existing = await prisma.physicalStock.findMany();
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

    if (toCreate.length > 0) {
      await prisma.physicalStock.createMany({ data: toCreate });
    }

    return {
      success: true,
      created: toCreate.length,
      skipped,
      totalRows: rows.length,
      syncedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
