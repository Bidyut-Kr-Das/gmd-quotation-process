/**
 * Scheduled step 1 — GMD UPDATION catalogue -> GMDUpdateItem.
 *
 * A faithful port of the manual sync in
 * `app/raw_material/api/gmd-update/sync/route.ts:70-243`, which is left
 * untouched so the Raw Material Sync button keeps its exact current
 * behaviour. Behavioural rules are preserved:
 *
 *   - Creates rows for ERP codes not already in the DB (all 25 sheet fields).
 *   - On existing codes, overwrites ONLY the 12 NON_EDITABLE_FIELDS, and only
 *     when the sheet value is non-blank and differs. A blank sheet cell never
 *     clears a stored value, so anything a user edited in the UI survives.
 *   - Every row the sheet owns is stamped with `syncedAt`, changed or not.
 *   - Rows whose NEW ITEM STATUS is CLOSED / TO BE CLOSED / TO BE LOCKED are
 *     dropped entirely.
 *   - Blank ERP codes and in-sheet duplicates are skipped (first one wins).
 *   - `availableStock` is seeded from the stock-phys overlay on create only;
 *     refreshing existing stock is step 2's job.
 *   - `itemNameDerived` is recomputed for created and changed codes.
 *   - Never deletes.
 *
 * Two deliberate differences from the manual version, neither of which drops a
 * feature:
 *   1. The manual file's `EDITABLE_FIELDS` set is not carried over. It is
 *      referenced nowhere in the repo — user-edit protection actually comes
 *      from the NON_EDITABLE_FIELDS allowlist.
 *   2. The response reports honest skip counters instead of the manual route's
 *      `skipped` figure, which is a subtraction that does not mean "skipped".
 *
 * On top of that, Prisma concurrency is bounded with `p-limit` because this
 * runs hourly against the production DB, where the manual route fans out 200
 * concurrent calls per chunk.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import {
  fetchGMDUpdateSheet,
  fetchStockPhysicalSheet,
} from "@/lib/gmd_lib/google-sheets";
import { sheetRowToDbItem } from "@/lib/gmd_lib/mapSheetRow";
import { syncDerivedItemNames } from "./derived-item-name";

/** Canonical index of `ERP ITEM CODE` in a reordered sheet row. */
const ERP_CODE_IDX = 0;

/** Canonical index of `Available Stock` in a reordered sheet row. */
const AVAILABLE_STOCK_IDX = 11;

/**
 * Sheet-owned fields that may be overwritten on an existing row. Anything NOT
 * in this list (cost, aum, hsnCode, availableStock, rmType, ...) is
 * user-owned and is never touched.
 */
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

/** NEW ITEM STATUS values whose rows are excluded from the DB entirely. */
const SKIPPED_STATUSES = new Set(["CLOSED", "TO BE CLOSED", "TO BE LOCKED"]);

/** Rows per Prisma fan-out, and how many of those may be in flight at once. */
const CHUNK_SIZE = 200;
const WRITE_CONCURRENCY = 10;

/** Columns compared when diffing an existing row against the sheet. */
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
} as const;

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export type CatalogueSyncResult = {
  syncedAt: string;
  totalInSheet: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Rows dropped because NEW ITEM STATUS is CLOSED / TO BE CLOSED / TO BE LOCKED. */
  skippedByStatus: number;
  /** Rows dropped because the ERP ITEM CODE cell was blank. */
  blankCode: number;
  /** Rows dropped because an earlier row in the sheet already used that code. */
  duplicateInSheet: number;
  /** Rows whose sheet code is absent from stock-phys, so no stock was overlaid. */
  noStockInSheet: number;
  /** Individual Prisma writes that rejected. */
  failedWrites: number;
  changedColumns: Record<string, number>;
  createdCodes: string[];
  derivedCount: number;
  derivedFailed: number;
  elapsedMs: number;
};

/**
 * Pulls GMD UPDATION + stock-phys and diffs them into GMDUpdateItem.
 *
 * Throws on a fatal error (sheet unreachable, OAuth failure, DB down) so the
 * orchestrator can abort before step 2 writes stock against a half-synced
 * table. Per-row write failures are counted, not thrown.
 */
export async function runGmdCatalogueSync(
  concurrency = WRITE_CONCURRENCY,
): Promise<CatalogueSyncResult> {
  const startedAt = Date.now();

  const [data, stockMap] = await Promise.all([
    fetchGMDUpdateSheet(),
    fetchStockPhysicalSheet(),
  ]);

  const syncedAt = new Date();

  // Overlay counted physical stock onto the in-memory row so the physical
  // value wins over GMD UPDATION's own (stale) Available Stock column. This
  // only takes effect for rows we create — step 2 refreshes the rest.
  const mergedRows = data.rows.map((row) => {
    const erpCode = String(row[ERP_CODE_IDX] ?? "").trim().toUpperCase();
    const stockVal = erpCode ? stockMap[erpCode] : undefined;

    if (stockVal !== undefined && stockVal.trim() !== "") {
      const newRow = [...row];
      newRow[AVAILABLE_STOCK_IDX] = stockVal;
      return newRow;
    }

    return row;
  });

  const dbItems = mergedRows.map((row) => sheetRowToDbItem(row, syncedAt));

  const liveDbItems = dbItems.filter(
    (item) =>
      !SKIPPED_STATUSES.has(
        String(item.newItemStatus ?? "").trim().toUpperCase(),
      ),
  );

  const skippedByStatus = dbItems.length - liveDbItems.length;

  const existingRows = await prisma.rawMaterial.findMany({
    select: EXISTING_SELECT,
  });

  const existingByCode = new Map<string, (typeof existingRows)[number]>();
  for (const item of existingRows) {
    const code = (item.erpItemCode ?? "").trim();
    // First DB row wins if duplicates somehow exist.
    if (!code || existingByCode.has(code)) continue;
    existingByCode.set(code, item);
  }

  type DbItem = (typeof dbItems)[number];

  const toCreate: DbItem[] = [];
  const toUpdate: {
    id: string;
    data: Record<string, unknown>;
    isChange: boolean;
  }[] = [];

  const changedColumns: Record<string, number> = {};
  const seen = new Set<string>();
  const changedCodes: string[] = [];

  let blankCode = 0;
  let duplicateInSheet = 0;
  let noStockInSheet = 0;

  for (const item of liveDbItems) {
    const code = (item.erpItemCode ?? "").trim();

    if (!code) {
      blankCode++;
      continue;
    }

    if (seen.has(code)) {
      duplicateInSheet++;
      continue;
    }
    seen.add(code);

    const erpKey = code.toUpperCase();
    if (stockMap[erpKey] === undefined || stockMap[erpKey].trim() === "") {
      noStockInSheet++;
    }

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
      // A blank sheet cell must never clear a stored value.
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
      toUpdate.push({ id: existing.id, data: { syncedAt }, isChange: false });
    }
  }

  const createdCodes = toCreate.map((item) => (item.erpItemCode ?? "").trim());

  let failedWrites = 0;
  const limit = pLimit(concurrency);

  if (toCreate.length > 0) {
    try {
      await prisma.rawMaterial.createMany({ data: toCreate });
    } catch (err) {
      throw new Error(
        `Catalogue createMany failed for ${toCreate.length} row(s): ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  let updated = 0;
  let unchanged = 0;

  for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
    const chunk = toUpdate.slice(i, i + CHUNK_SIZE);

    const settled = await Promise.allSettled(
      chunk.map((u) =>
        limit(() =>
          prisma.gMDUpdateItem.update({ where: { id: u.id }, data: u.data }),
        ),
      ),
    );

    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        failedWrites++;
        console.error(
          `[gmd-update-catalogue] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
        return;
      }

      if (chunk[idx].isChange) updated++;
      else unchanged++;
    });
  }

  // Recompute the derived name for every row we created or actually changed.
  const deriveCodes = [...new Set([...createdCodes, ...changedCodes])];
  const derived = await syncDerivedItemNames(deriveCodes, concurrency);

  for (const failure of derived.failures) {
    console.error(
      `[gmd-update-catalogue] derive failed code=${failure.itemCode} err=${failure.error}`,
    );
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] GMD UPDATION CATALOGUE =====");
  console.log(`[scheduler] Synced at        : ${syncedAt.toISOString()}`);
  console.log(`[scheduler] Rows in sheet    : ${data.rows.length}`);
  console.log(`[scheduler] Already in DB    : ${existingRows.length}`);
  console.log(
    `[scheduler] created=${createdCodes.length} updated=${updated} unchanged=${unchanged} total=${createdCodes.length + updated + unchanged}`,
  );
  console.log(
    `[scheduler] skippedByStatus=${skippedByStatus} blankCode=${blankCode} duplicateInSheet=${duplicateInSheet} noStockInSheet=${noStockInSheet} failedWrites=${failedWrites}`,
  );
  console.log(`[scheduler] Changed columns  :`, changedColumns);
  console.log(
    `[scheduler] Derived names     : ${derived.derived}/${deriveCodes.length} (failed=${derived.failed})`,
  );
  console.log(`[scheduler] Elapsed          : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] CATALOGUE DONE =====\n");

  return {
    syncedAt: syncedAt.toISOString(),
    totalInSheet: data.rows.length,
    created: createdCodes.length,
    updated,
    unchanged,
    skippedByStatus,
    blankCode,
    duplicateInSheet,
    noStockInSheet,
    failedWrites,
    changedColumns,
    createdCodes,
    derivedCount: derived.derived,
    derivedFailed: derived.failed,
    elapsedMs,
  };
}