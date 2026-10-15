/**
 * Scheduled step — sale-bill `RATE` -> `SupplyHistoryItem.rate`, then the
 * `value = quantity x rate` gap-fill.
 *
 * Source: the `SALE_BILL_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` —
 * the same tab `lib/executionTrackingSync.ts` diffs, read here through the same
 * `readSheetTabByGid` helper. Read **without** a fiscal-year filter, so rows
 * from every year backfill in one pass, not just the current one.
 *
 * Keyed on the exact `(VRNO, ITEM_CODE)` pair — the pair that engine already
 * treats as the row identity — normalised on both sides. A sheet line with no
 * item code cannot be attributed to one row when its invoice owns several, so
 * it is skipped and counted (`skippedNoCode`) rather than guessed.
 *
 * Write policy — **gap-fill only, nothing is ever overwritten or cleared**:
 *   - `rate` is written only where the DB cell is blank;
 *   - `value` is written only where the DB cell is blank and both `quantity`
 *     and `rate` parse as numbers (a stored rate is used too, not just the
 *     sheet's);
 *   - a blank sheet cell therefore can never clear a value.
 *
 * `value` also has a second writer — the MASTER sync, from MASTER's own `Value`
 * column, which runs first in the job. Because this step only fills blanks, the
 * two cannot ping-pong: MASTER's value always wins where it exists, and
 * `quantity x rate` fills the rest.
 *
 * Note `value / quantity` is the RM unit cost in `lib/gmdBomCostLookup.ts`, so
 * this step moves quotation product cost for the rows it fills.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { cell, findColumn, readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import {
  executionTrackingSpreadsheetId,
  isBlankSheetValue,
  normalizeKey,
  saleBillGid,
} from "@/lib/gmd_lib/execution-tracking-columns";

/** The rate column on the SALE_BILL tab. Confirmed with the sheet owner. */
const RATE_HEADER = "RATE";
/** Invoice number (`VRNO`) — half 1 of the match key, as in the engine. */
const INVOICE_HEADER = "VRNO";
/** Item code — half 2 of the match key. */
const ITEM_CODE_HEADER = "ITEM_CODE";

/** Rows per write chunk, and how many may be in flight at once. */
const WRITE_CHUNK = 200;
const WRITE_CONCURRENCY = 10;

export type SupplyRateBackfillResult = {
  tabTitle: string;
  /** Data rows read from the tab. */
  sheetRows: number;
  /** Distinct `(VRNO, ITEM_CODE)` groups that carry a rate. */
  sheetGroups: number;
  /** Sheet lines dropped for a missing invoice number or item code. */
  skippedNoCode: number;
  /** Sheet groups with no matching `SupplyHistoryItem` row. */
  groupsUnmatched: number;
  /** `SupplyHistoryItem` rows considered. */
  rowsScanned: number;
  /** Rows whose blank `rate` was filled. */
  rateFilled: number;
  /** Rows whose blank `value` was filled with `quantity x rate`. */
  valueFilled: number;
  failedWrites: number;
  elapsedMs: number;
};

/** `1234.5` -> `"1234.5"`, `1506` -> `"1506"`; no separators, no float noise. */
export function formatValue(total: number): string {
  return String(Number(total.toFixed(2)));
}

/** `1,234.5` and `1234.5` both parse; anything else is `null`. */
export function toNumber(value: unknown): number | null {
  const parsed = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** `(VRNO, ITEM_CODE)` -> the map key, normalised on both halves. */
export function rateKey(invoiceNo: unknown, itemCode: unknown): string {
  return `${normalizeKey(invoiceNo)}||${normalizeKey(itemCode)}`;
}

/**
 * Reduces the tab to `(invoice, item code) -> rate`, first non-blank rate wins
 * — the same fold rule the execution-tracking engine applies per group.
 *
 * Throws when a required column is gone: silently skipping a mapping is how a
 * sync stops updating without anyone noticing.
 */
export function buildRateMap(
  headers: string[],
  rows: string[][],
): {
  rates: Map<string, string>;
  sheetRows: number;
  skippedNoCode: number;
  skippedBlankRate: number;
} {
  const required = [INVOICE_HEADER, ITEM_CODE_HEADER, RATE_HEADER];
  const indexes = required.map((h) => findColumn(headers, h));
  const missing = required.filter((_, i) => indexes[i] === -1);
  if (missing.length > 0) {
    throw new Error(`SALE BILL tab is missing required column(s): ${missing.join(", ")}`);
  }
  const [invoiceIdx, itemCodeIdx, rateIdx] = indexes;

  const rates = new Map<string, string>();
  let skippedNoCode = 0;
  let skippedBlankRate = 0;

  for (const row of rows) {
    const invoiceNo = cell(row, invoiceIdx);
    const itemCode = cell(row, itemCodeIdx);
    if (!invoiceNo || !itemCode) {
      skippedNoCode++;
      continue;
    }
    const rate = cell(row, rateIdx);
    if (isBlankSheetValue(rate)) {
      skippedBlankRate++;
      continue;
    }
    const key = rateKey(invoiceNo, itemCode);
    if (!rates.has(key)) rates.set(key, rate);
  }

  return { rates, sheetRows: rows.length, skippedNoCode, skippedBlankRate };
}

/** The `SupplyHistoryItem` slice this step reads. */
export type RateRow = {
  id: string;
  invoiceNo: string | null;
  erpItemCode: string | null;
  rate: string | null;
  quantity: string | null;
  value: string | null;
};

export type RatePlan = {
  updates: { id: string; data: Record<string, string> }[];
  rowsScanned: number;
  rateFilled: number;
  valueFilled: number;
  groupsMatched: number;
  groupsUnmatched: number;
};

function textOrNull(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Decides, per row, which blank cells to fill. Pure so the policy can be tested
 * without a database or a sheet.
 */
export function planRateBackfill(
  rows: readonly RateRow[],
  rates: ReadonlyMap<string, string>,
): RatePlan {
  const updates: RatePlan["updates"] = [];
  const matchedKeys = new Set<string>();
  let rateFilled = 0;
  let valueFilled = 0;

  for (const row of rows) {
    const key = rateKey(row.invoiceNo ?? "", row.erpItemCode ?? "");
    const sheetRate = rates.get(key);
    if (sheetRate !== undefined) matchedKeys.add(key);

    const data: Record<string, string> = {};

    let rate = textOrNull(row.rate);
    if (!rate && sheetRate !== undefined) {
      rate = sheetRate;
      data.rate = sheetRate;
      rateFilled++;
    }

    if (!textOrNull(row.value) && rate) {
      const quantity = toNumber(row.quantity);
      const rateNumber = toNumber(rate);
      if (quantity !== null && rateNumber !== null) {
        data.value = formatValue(quantity * rateNumber);
        valueFilled++;
      }
    }

    if (Object.keys(data).length > 0) updates.push({ id: row.id, data });
  }

  return {
    updates,
    rowsScanned: rows.length,
    rateFilled,
    valueFilled,
    groupsMatched: matchedKeys.size,
    groupsUnmatched: rates.size - matchedKeys.size,
  };
}

/**
 * Reads the sale-bill tab, gap-fills `rate` and `value`. Throws on a fatal
 * error (sheet unreachable, required column gone, OAuth failure); individual
 * write failures are counted instead of aborting the run.
 */
export async function runSupplyRateBackfill(): Promise<SupplyRateBackfillResult> {
  const startedAt = Date.now();

  const spreadsheetId = executionTrackingSpreadsheetId();
  const gid = saleBillGid();
  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, gid);

  const { rates, sheetRows, skippedNoCode, skippedBlankRate } = buildRateMap(headers, rows);

  // Only rows that actually have a blank to fill are worth loading.
  const dbRows = (await prisma.supplyHistoryItem.findMany({
    where: {
      OR: [{ rate: null }, { rate: "" }, { value: null }, { value: "" }],
    },
    select: {
      id: true,
      invoiceNo: true,
      erpItemCode: true,
      rate: true,
      quantity: true,
      value: true,
    },
  })) as RateRow[];

  const plan = planRateBackfill(dbRows, rates);

  const limit = pLimit(WRITE_CONCURRENCY);
  let failedWrites = 0;

  for (let i = 0; i < plan.updates.length; i += WRITE_CHUNK) {
    const chunk = plan.updates.slice(i, i + WRITE_CHUNK);
    const settled = await Promise.allSettled(
      chunk.map((u) =>
        limit(() =>
          prisma.supplyHistoryItem.update({
            where: { id: u.id },
            data: u.data,
          }),
        ),
      ),
    );
    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        failedWrites++;
        console.error(
          `[supply-rate-backfill] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
      }
    });
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] SUPPLY RATE BACKFILL =====");
  console.log(`[scheduler] tab              : ${tabTitle} (gid ${gid})`);
  console.log(
    `[scheduler] sheet rows       : ${sheetRows} (no code/invoice: ${skippedNoCode}, blank rate: ${skippedBlankRate})`,
  );
  console.log(`[scheduler] rate groups      : ${rates.size}`);
  console.log(`[scheduler] db rows scanned  : ${plan.rowsScanned}`);
  console.log(`[scheduler] rate filled      : ${plan.rateFilled}`);
  console.log(`[scheduler] value filled     : ${plan.valueFilled}`);
  console.log(
    `[scheduler] groups matched   : ${plan.groupsMatched} unmatched=${plan.groupsUnmatched}`,
  );
  console.log(`[scheduler] failed writes    : ${failedWrites}`);
  console.log(`[scheduler] elapsed          : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] SUPPLY RATE DONE =====\n");

  return {
    tabTitle,
    sheetRows,
    sheetGroups: rates.size,
    skippedNoCode,
    groupsUnmatched: plan.groupsUnmatched,
    rowsScanned: plan.rowsScanned,
    rateFilled: plan.rateFilled,
    valueFilled: plan.valueFilled,
    failedWrites,
    elapsedMs,
  };
}
