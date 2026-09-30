import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchGMDUpdateSheet,
  fetchStockPhysicalSheet,
} from "@/lib/gmd_lib/google-sheets";
import { sheetRowToDbItem } from "@/lib/gmd_lib/mapSheetRow";
import { updateDerivedItemName } from "@/app/actions";

const ERP_CODE_IDX = 0;
const AVAILABLE_STOCK_IDX = 11;

// Columns the user can edit in the UI — never overwritten for existing rows.
const EDITABLE_FIELDS = new Set([
  "conv1",
  "aum",
  "pcsWgt",
  "cost",
  "availableStock",
  "indianImported",
  "usdRateOption",
  "hsnCode",
  "hsnCodeValidation",
  "majorMarking",
  "rmType",
  "orderDelivery",
  "newItemStatus",
]);

// Non-editable sheet fields — overwritten when the sheet has a value that differs.
const NON_EDITABLE_FIELDS = [
  "itemNameAuto",
  "l1",
  "l2ValveType",
  "l3Dia",
  "l7Dimension",
  "l4Component",
  "l5Material",
  "l6Std",
  "l8ItemCategory",
  "um",
  "conv2",
  "currentStatus",
] as const;

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

const EXISTING_SELECT = {
  id: true,
  erpItemCode: true,
  itemNameAuto: true,
  l1: true,
  l2ValveType: true,
  l3Dia: true,
  l7Dimension: true,
  l4Component: true,
  l5Material: true,
  l6Std: true,
  l8ItemCategory: true,
  um: true,
  conv2: true,
  currentStatus: true,
  // newItemStatus: true,
} as const;

export async function POST() {
  try {
    const data = await fetchGMDUpdateSheet();
    const stockMap = await fetchStockPhysicalSheet();
    const syncedAt = new Date();

    const mergedRows = data.rows.map((row) => {
      const erpCode = String(row[ERP_CODE_IDX] ?? "").trim();
      const stockVal = stockMap[erpCode];
      if (stockVal) {
        const newRow = [...row];
        newRow[AVAILABLE_STOCK_IDX] = stockVal;
        return newRow;
      }
      return row;
    });

    const dbItems = mergedRows.map((row) => sheetRowToDbItem(row, syncedAt));

    const SKIPPED_STATUSES = new Set([
      "CLOSED",
      "TO BE CLOSED",
      "TO BE LOCKED",
    ]);
    const liveDbItems = dbItems.filter(
      (item) =>
        !SKIPPED_STATUSES.has(
          String(item.newItemStatus ?? "").trim().toUpperCase(),
        ),
    );

    const existingRows = await prisma.gMDUpdateItem.findMany({
      select: EXISTING_SELECT,
    });
    const existingByCode = new Map<string, (typeof existingRows)[number]>();
    for (const item of existingRows) {
      const code = (item.erpItemCode ?? "").trim();
      if (!code || existingByCode.has(code)) continue;
      existingByCode.set(code, item);
    }

    const toCreate: (typeof dbItems)[number][] = [];
    const toUpdate: {
      id: string;
      data: Record<string, unknown>;
      isChange: boolean;
    }[] = [];
    const changedColumns: Record<string, number> = {};
    const seen = new Set<string>();
    const changedCodes: string[] = [];

    for (const item of liveDbItems) {
      const code = (item.erpItemCode ?? "").trim();
      if (!code) continue;
      if (seen.has(code)) continue;
      seen.add(code);

      const existing = existingByCode.get(code);
      if (!existing) {
        toCreate.push(item);
        continue;
      }

      const dataUpdate: Record<string, unknown> = {};
      const existingAny = existing as unknown as Record<string, unknown>;
      const itemAny = item as unknown as Record<string, unknown>;
      for (const field of NON_EDITABLE_FIELDS) {
        const sheetVal = itemAny[field];
        if (isNullOrEmpty(sheetVal)) continue;
        const dbVal = existingAny[field];
        if (String(dbVal ?? "").trim() !== String(sheetVal).trim()) {
          dataUpdate[field] = String(sheetVal).trim();
          changedColumns[field] = (changedColumns[field] ?? 0) + 1;
        }
      }

      if (Object.keys(dataUpdate).length > 0) {
        dataUpdate.syncedAt = syncedAt;
        toUpdate.push({ id: existing.id, data: dataUpdate, isChange: true });
        changedCodes.push(code);
      } else {
        toUpdate.push({
          id: existing.id,
          data: { syncedAt },
          isChange: false,
        });
      }
    }

    if (toCreate.length > 0) {
      await prisma.gMDUpdateItem.createMany({ data: toCreate });
    }

    let updated = 0;
    let unchanged = 0;
    if (toUpdate.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((u) =>
            prisma.gMDUpdateItem.update({
              where: { id: u.id },
              data: u.data,
            }),
          ),
        );
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[gmd-update-sync] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
            );
            return;
          }
          if (chunk[idx].isChange) updated++;
          else unchanged++;
        });
      }
    }

    const createdCodes = toCreate.map((item) =>
      (item.erpItemCode ?? "").trim(),
    );

    // Recompute derived item name for rows that were created or changed.
    const deriveCodes = [...new Set([...createdCodes, ...changedCodes])];
    let derivedCount = 0;
    if (deriveCodes.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < deriveCodes.length; i += chunkSize) {
        const chunk = deriveCodes.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((code) => updateDerivedItemName(code)),
        );
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[gmd-update-sync] derive failed code=${chunk[idx]} err=${(r.reason as Error)?.message}`,
            );
            return;
          }
          if (r.value?.success) derivedCount++;
        });
      }
    }

    console.log("\n===== [SYNC] GMD UPDATION SHEET → DB =====");
    console.log(`[SYNC] Synced at      : ${syncedAt.toISOString()}`);
    console.log(`[SYNC] Rows in sheet  : ${data.rows.length}`);
    console.log(`[SYNC] Already in DB  : ${existingRows.length}`);
    console.log(
      `[gmd-update-sync] Summary: created=${toCreate.length} updated=${updated} unchanged=${unchanged} total=${toCreate.length + updated + unchanged}`,
    );
    console.log(`[gmd-update-sync] Changed columns:`, changedColumns);
    console.log(`[gmd-update-sync] Derived item names updated: ${derivedCount}/${deriveCodes.length}`);
    if (createdCodes.length > 0) {
      console.log(`[SYNC] New ERP codes  : ${createdCodes.length}`);
      createdCodes.forEach((code, i) =>
        console.log(`[SYNC]   ${i + 1}. ${code}`),
      );
    } else {
      console.log("[SYNC] No new ERP codes — DB is up to date.");
    }
    console.log("===== [SYNC] DONE =====\n");

    return NextResponse.json({
      syncedAt,
      created: toCreate.length,
      updated,
      unchanged,
      changedColumns,
      skipped: data.rows.length - toCreate.length - (dbItems.length - liveDbItems.length),
      totalInSheet: data.rows.length,
      createdCodes,
      derivedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
