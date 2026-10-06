/**
 * Scheduled job — ITEM MASTER ERP -> `cBatch` marks on four tables.
 *
 * Port of the "Sync C Batch" button, whose handler is
 * `syncCBatchAction` in `app/actions.ts:5039-5218` — left untouched. Unlike the
 * other buttons ported here, that action's logic is entirely inline in a
 * `"use server"` module, so this is a real port rather than a delegation. Only
 * the sheet read is reused, via the already-exported primitives in
 * `lib/gmd_lib/bomMastErp.ts`.
 *
 * Signal: `ITEM_STATUS` trimmed + upper-cased equals exactly `"C"`, keyed on
 * `ITEM_CODE` trimmed + upper-cased, from the `ITEM MASTER ERP` tab
 * (gid 253020709) of the BOM MAST ERP workbook.
 *
 * Targets — writes `cBatch = "C"` and nothing else:
 *   RawMaterial.erpItemCode | ContractReview.itemCode
 *   SupplyHistoryItem.erpItemCode | EnquiryItem.erpItemCode OR rmItemCode
 *
 * `VerifyBom` is deliberately NOT written: `/bom`'s `cBatch` comes from the BOM
 * MAST ERP `TO_DATE` flow, which is a different signal.
 *
 * SET-ONLY BY DESIGN: nothing is ever cleared. A code that flips C -> U, or
 * disappears from the sheet, keeps the mark it already has, so re-running is
 * idempotent and a bad run cannot destroy data.
 *
 * Four bugs in the original are fixed here; each is marked CHANGE below.
 */

import { prisma } from "@/lib/prisma";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  ITEM_MASTER_ERP_GID,
  cell,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";

const C_BATCH_VALUE = "C";
const WRITE_CHUNK = 1000;

/** A row as far as the planner is concerned. */
export type CBatchRow = {
  id: string;
  cBatch: string | null;
  /** Code columns; a match in ANY of them marks the row. */
  codes: (string | null)[];
};

export type CBatchPlan = {
  /** Rows already carrying a mark that still match — never rewritten. */
  alreadyMarked: number;
  /** Rows matching with no mark yet — these are the only ones written. */
  pendingIds: string[];
  /** Rows matching at all. */
  matchedRows: number;
  /** Distinct non-blank codes present across the table. */
  distinctCodes: number;
  /** Distinct codes that are C in the sheet. */
  matchedCodes: number;
};

/**
 * Pure planner: decides which rows need the mark.
 *
 * Split out from the DB access (the same pattern as `planStockWrites` and the
 * repo's existing `planContractPhysicalStock`) so the edge cases can be tested
 * without a database.
 *
 * CHANGE 1: rows are selected by `id`, not by code. The original built its
 * `updateMany` filter from `matched`, which is upper-cased, while the code
 * columns are persisted with whatever case the source sheet used — Postgres
 * `IN` is byte-exact. So a lower-case row was counted as pending, shown as
 * `+N` in the dialog, and silently never marked. Selecting on the primary key
 * removes that whole class of mismatch.
 *
 * CHANGE 2: only pending rows are returned, so already-marked rows are not
 * rewritten (and do not churn `updatedAt`) on every run.
 *
 * CHANGE 3: `cCodes` is a Set. The original's RawMaterial block used
 * `matched.includes(...)` — O(n*m) over ~4279 codes, twice per invocation.
 */
export function planCBatchMarks(
  rows: CBatchRow[],
  cCodes: Set<string>,
): CBatchPlan {
  const distinct = new Set<string>();
  for (const row of rows) {
    for (const raw of row.codes) {
      const k = String(raw ?? "").trim().toUpperCase();
      if (k) distinct.add(k);
    }
  }

  let matchedRows = 0;
  let alreadyMarked = 0;
  const pendingIds: string[] = [];

  for (const row of rows) {
    let isC = false;
    for (const raw of row.codes) {
      const k = String(raw ?? "").trim().toUpperCase();
      if (k && cCodes.has(k)) {
        isC = true;
        break;
      }
    }
    if (!isC) continue;

    matchedRows++;
    if (row.cBatch) alreadyMarked++;
    else pendingIds.push(row.id);
  }

  return {
    alreadyMarked,
    pendingIds,
    matchedRows,
    distinctCodes: distinct.size,
    matchedCodes: cCodes.size,
  };
}

export type CBatchTableResult = {
  table: string;
  fields: string;
  distinctCodes: number;
  matchedCodes: number;
  /** Rows actually written. */
  rowsUpdated: number;
  /** Rows already carrying a mark. */
  alreadyMarked: number;
  /** Non-fatal write failure count for this table. */
  failedWrites: number;
};

export type CBatchSyncResult = {
  tabTitle: string;
  /** Codes parsed from the sheet. */
  sheetCodes: number;
  /** Codes whose ITEM_STATUS is exactly "C". */
  cCodes: number;
  /** Sheet rows skipped as duplicate ITEM_CODE. */
  duplicateSheetCodes: number;
  dryRun: boolean;
  perTable: CBatchTableResult[];
  /** Tables that failed outright; the rest still applied. */
  failedTables: string[];
  elapsedMs: number;
};

export type CBatchSyncOptions = {
  /** Count and report without writing anything. */
  dryRun?: boolean;
};

/**
 * CHANGE 4: parses the sheet with a `seen` set keyed on the code itself.
 *
 * `readItemMasterErp` guards duplicates on `nameByCode.has(code)`, so when a
 * code's first row has an ITEM_NAME but a BLANK ITEM_STATUS, the later
 * duplicate is skipped and its `"C"` status is silently discarded — the row is
 * then never marked. Keying on the code fixes that and makes the
 * first-row-wins rule mean what it says. The sheet-read plumbing is reused from
 * the same module, so nothing about the Google calls is duplicated.
 */
async function readCStatusCodes(): Promise<{
  tabTitle: string;
  statusByCode: Map<string, string>;
  duplicateCodes: number;
}> {
  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    ITEM_MASTER_ERP_GID,
  );

  const [codeIdx, , statusIdx] = requireColumns(
    headers,
    ["ITEM_CODE", "ITEM_NAME", "ITEM_STATUS"],
    tabTitle,
  );

  const statusByCode = new Map<string, string>();
  const seen = new Set<string>();
  let duplicateCodes = 0;

  for (const row of rows) {
    const itemCode = cell(row, codeIdx).toUpperCase();
    if (!itemCode) continue;
    if (seen.has(itemCode)) {
      duplicateCodes++;
      continue;
    }
    seen.add(itemCode);

    const status = cell(row, statusIdx).toUpperCase();
    if (status) statusByCode.set(itemCode, status);
  }

  return { tabTitle, statusByCode, duplicateCodes };
}

/** Applies a plan to one table. Never throws; failures are reported per table. */
async function applyToTable(
  table: string,
  fields: string,
  load: () => Promise<CBatchRow[]>,
  write: (ids: string[]) => Promise<{ count: number; failedWrites: number }>,
  cCodes: Set<string>,
  dryRun: boolean,
): Promise<CBatchTableResult> {
  const rows = await load();
  const plan = planCBatchMarks(rows, cCodes);

  let rowsUpdated = 0;
  let failedWrites = 0;

  if (!dryRun && plan.pendingIds.length > 0) {
    for (let i = 0; i < plan.pendingIds.length; i += WRITE_CHUNK) {
      const chunk = plan.pendingIds.slice(i, i + WRITE_CHUNK);
      try {
        const res = await write(chunk);
        rowsUpdated += res.count;
        failedWrites += res.failedWrites;
      } catch (err) {
        failedWrites += chunk.length;
        console.error(
          `[c-batch] ${table} chunk failed (${chunk.length} rows) err=${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }
  }

  return {
    table,
    fields,
    distinctCodes: plan.distinctCodes,
    matchedCodes: plan.matchedCodes,
    rowsUpdated,
    alreadyMarked: plan.alreadyMarked,
    failedWrites,
  };
}

/**
 * Marks `cBatch = "C"` on every row whose item code carries
 * `ITEM_STATUS = "C"` in ITEM MASTER ERP.
 *
 * Steps are isolated per table: if one throws, the others still apply and the
 * failure is reported. The original wrapped all four in one try/catch that
 * discarded the accumulated `perTable`, so a partial write was indistinguishable
 * from no write.
 */
export async function runCBatchSync(
  options: CBatchSyncOptions = {},
): Promise<CBatchSyncResult> {
  const { dryRun = false } = options;
  const startedAt = Date.now();

  const { tabTitle, statusByCode, duplicateCodes } = await readCStatusCodes();

  const cCodes = new Set<string>();
  for (const [code, status] of statusByCode) {
    if (status === C_BATCH_VALUE) cCodes.add(code);
  }

  const perTable: CBatchTableResult[] = [];
  const failedTables: string[] = [];

  // CHANGE 5: each table is attempted independently and its failure recorded,
  // so a throw on table 3 cannot hide tables 1-2 having been committed.
  const targets: {
    table: string;
    fields: string;
    load: () => Promise<CBatchRow[]>;
    write: (ids: string[]) => Promise<{ count: number; failedWrites: number }>;
  }[] = [
    {
      // NOTE: the comment in the original says "GMDUpdateItem.erpItemCode" but
      // the code reads prisma.rawMaterial. The code is right — the UI reads
      // prisma.rawMaterial (app/raw_material/api/gmd-update/route.ts:9).
      // RawMaterial and GMDUpdateItem are two different tables.
      table: "RawMaterial",
      fields: "erpItemCode",
      load: async () =>
        (await prisma.rawMaterial.findMany({ select: { id: true, erpItemCode: true, cBatch: true } }))
          .map((r) => ({ id: r.id, cBatch: r.cBatch, codes: [r.erpItemCode] })),
      write: async (ids) => ({
        count: (await prisma.rawMaterial.updateMany({
          where: { id: { in: ids } },
          data: { cBatch: C_BATCH_VALUE },
        })).count,
        failedWrites: 0,
      }),
    },
    {
      table: "ContractReview",
      fields: "itemCode",
      load: async () =>
        (await prisma.contractReview.findMany({ select: { id: true, itemCode: true, cBatch: true } }))
          .map((r) => ({ id: r.id, cBatch: r.cBatch, codes: [r.itemCode] })),
      write: async (ids) => ({
        count: (await prisma.contractReview.updateMany({
          where: { id: { in: ids } },
          data: { cBatch: C_BATCH_VALUE },
        })).count,
        failedWrites: 0,
      }),
    },
    {
      table: "SupplyHistoryItem",
      fields: "erpItemCode",
      load: async () =>
        (await prisma.supplyHistoryItem.findMany({ select: { id: true, erpItemCode: true, cBatch: true } }))
          .map((r) => ({ id: r.id, cBatch: r.cBatch, codes: [r.erpItemCode] })),
      write: async (ids) => ({
        count: (await prisma.supplyHistoryItem.updateMany({
          where: { id: { in: ids } },
          data: { cBatch: C_BATCH_VALUE },
        })).count,
        failedWrites: 0,
      }),
    },
    {
      // A match in EITHER column marks the row.
      table: "EnquiryItem",
      fields: "erpItemCode + rmItemCode",
      load: async () =>
        (await prisma.enquiryItem.findMany({
          select: { id: true, erpItemCode: true, rmItemCode: true, cBatch: true },
        })).map((r) => ({
          id: r.id,
          cBatch: r.cBatch,
          codes: [r.erpItemCode, r.rmItemCode],
        })),
      write: async (ids) => ({
        count: (await prisma.enquiryItem.updateMany({
          where: { id: { in: ids } },
          data: { cBatch: C_BATCH_VALUE },
        })).count,
        failedWrites: 0,
      }),
    },
  ];

  for (const target of targets) {
    try {
      perTable.push(
        await applyToTable(
          target.table,
          target.fields,
          target.load,
          target.write,
          cCodes,
          dryRun,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[c-batch] ${target.table} failed: ${message}`);
      failedTables.push(target.table);
      perTable.push({
        table: target.table,
        fields: target.fields,
        distinctCodes: 0,
        matchedCodes: cCodes.size,
        rowsUpdated: 0,
        alreadyMarked: 0,
        failedWrites: 0,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const totalUpdated = perTable.reduce((n, t) => n + t.rowsUpdated, 0);
  const totalAlready = perTable.reduce((n, t) => n + t.alreadyMarked, 0);

  console.log("\n===== [SCHEDULER] C BATCH SYNC =====");
  console.log(`[scheduler] mode            : ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`[scheduler] tab             : ${tabTitle}`);
  console.log(`[scheduler] sheet codes     : ${statusByCode.size}`);
  console.log(`[scheduler] C codes         : ${cCodes.size}`);
  console.log(
    `[scheduler] duplicate sheet rows : ${duplicateCodes}${
      duplicateCodes ? " (first row wins)" : ""
    }`,
  );
  for (const t of perTable) {
    console.log(
      `[scheduler] ${t.table.padEnd(18)} matched=${t.matchedCodes} distinct=${t.distinctCodes} updated=${t.rowsUpdated} alreadyMarked=${t.alreadyMarked} failed=${t.failedWrites}`,
    );
  }
  console.log(`[scheduler] totals          : updated=${totalUpdated} alreadyMarked=${totalAlready}`);
  if (failedTables.length) console.log(`[scheduler] FAILED TABLES   : ${failedTables.join(", ")}`);
  console.log(`[scheduler] elapsed          : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] C BATCH DONE =====\n");

  return {
    tabTitle,
    sheetCodes: statusByCode.size,
    cCodes: cCodes.size,
    duplicateSheetCodes: duplicateCodes,
    dryRun,
    perTable,
    failedTables,
    elapsedMs,
  };
}