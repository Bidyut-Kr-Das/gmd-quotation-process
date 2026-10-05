/**
 * Scheduled step 2 — stock-phys `SUM OF PHYSICAL STOCK` -> availableStock.
 *
 * Ported from `scripts/sync-available-stock-from-stock-phys.ts:22-109`, which
 * is left untouched so `npm run stock:sync` keeps its current behaviour. This
 * version fixes three bugs in that script:
 *
 *   1. Case/whitespace mismatch. The script matched on
 *      `erpItemCode.trim().toUpperCase()` but then wrote with
 *      `updateMany({ where: { erpItemCode } })` — a case-SENSITIVE exact match.
 *      Any row whose stored code was lower-case or padded was reported as a
 *      change and then silently updated zero rows. Writes here are keyed on the
 *      primary key instead, so that class of mismatch cannot occur.
 *   2. Blank cells wiped real stock. The script compared
 *      `availableStock !== to` where `to` could be "", so a code present in
 *      stock-phys with an empty stock cell cleared the DB value to an empty
 *      string. A blank is skipped here: it never clears a stored value.
 *   3. Untrimmed comparison. `" 12 "` vs `"12"` registered as a change.
 *      Both sides are trimmed before comparing.
 *
 * `"0"` is deliberately treated as a real counted stock and is written, which
 * matches `syncNullVerifyBomStockAction` in `app/actions.ts`.
 *
 * Note that `SUM OF PHYSICAL STOCK` is a pre-aggregation maintained in the
 * Google Sheet (a pivot/QUERY result); nothing here sums anything itself.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { fetchStockPhysicalSheet } from "@/lib/gmd_lib/google-sheets";

/** Rows per Prisma fan-out, and how many of those may be in flight at once. */
const CHUNK_SIZE = 200;
const WRITE_CONCURRENCY = 10;

export type StockPhysSyncResult = {
  /** ERP codes present in the stock-phys tab. */
  sheetCodes: number;
  /** DB rows whose code exists in stock-phys. */
  matched: number;
  /** Matched rows whose stored stock differs from the sheet. */
  changed: number;
  /** Matched rows already up to date. */
  unchanged: number;
  /** Actual DB rows written. */
  updatedRows: number;
  /** DB rows (with a code) that stock-phys does not mention — never touched. */
  notInSheet: number;
  /** Sheet codes with a blank stock cell — skipped, never written. */
  skippedBlank: number;
  /** Codes in stock-phys that have no matching GMDUpdateItem row. */
  sheetCodesWithoutRow: number;
  /** Individual Prisma writes that rejected. */
  failedWrites: number;
  elapsedMs: number;
};

export type StockPhysSyncOptions = {
  /** Compute and report the diff without writing anything. */
  dryRun?: boolean;
  concurrency?: number;
};

/** The minimal DB shape the planner needs. */
export type StockPlanInput = {
  id: string;
  erpItemCode: string | null;
  availableStock: string | null;
};

export type StockPlanRow = {
  erpItemCode: string;
  id: string;
  from: string | null;
  to: string;
};

export type StockPlanResult = {
  /** Every matched row, changed or not. */
  matched: StockPlanRow[];
  /** Matched rows whose stored value actually differs from the sheet. */
  changed: StockPlanRow[];
  /** DB rows (with a code) that stock-phys does not mention — never touched. */
  notInSheet: number;
  /** Sheet codes with a blank stock cell — skipped, never written. */
  skippedBlank: number;
  /** Codes in stock-phys that matched no DB row. */
  sheetCodesWithoutRow: number;
};

/**
 * Pure planner: decides which GMDUpdateItem rows need a new stock value.
 *
 * Split out from `runStockPhysSync` (and shaped like the existing
 * `planContractPhysicalStock`) so the edge cases can be unit-tested without a
 * database or a Google Sheet. `stockMap` must already be keyed by trimmed,
 * upper-cased ERP code, which is what `fetchStockPhysicalSheet` returns.
 */
export function planStockWrites(
  items: StockPlanInput[],
  stockMap: Record<string, string>,
): StockPlanResult {
  const matched: StockPlanRow[] = [];
  const codesWithDbRow = new Set<string>();
  let notInSheet = 0;
  let skippedBlank = 0;

  for (const item of items) {
    // Bug fix 1 (read side): normalise before looking the code up, so a code
    // stored lower-case or padded still matches.
    const code = item.erpItemCode?.trim().toUpperCase();
    if (!code) continue;

    const raw = stockMap[code];
    if (raw === undefined) {
      notInSheet++;
      continue;
    }

    // Bug fix 2: a blank cell means "no count reported", not "zero stock".
    // Never let it clear a stored value. "0" still passes this check.
    if (raw.trim() === "") {
      skippedBlank++;
      continue;
    }

    codesWithDbRow.add(code);
    matched.push({
      id: item.id,
      erpItemCode: code,
      from: item.availableStock,
      to: raw.trim(),
    });
  }

  // Bug fix 3: compare trimmed so " 12 " vs "12" is not a false change.
  const changed = matched.filter((row) => (row.from ?? "").trim() !== row.to);

  const sheetCodesWithoutRow = Object.keys(stockMap).filter(
    (code) => !codesWithDbRow.has(code),
  );

  return {
    matched,
    changed,
    notInSheet,
    skippedBlank,
    sheetCodesWithoutRow: sheetCodesWithoutRow.length,
  };
}

/**
 * Refreshes `GMDUpdateItem.availableStock` from the stock-phys tab.
 *
 * Throws only on a fatal error (sheet unreachable, OAuth failure, DB down).
 * Per-row write failures are counted into `failedWrites`.
 */
export async function runStockPhysSync(
  options: StockPhysSyncOptions = {},
): Promise<StockPhysSyncResult> {
  const { dryRun = false, concurrency = WRITE_CONCURRENCY } = options;
  const startedAt = Date.now();

  // Keys are already trimmed + upper-cased by fetchStockPhysicalSheet.
  const stockMap = await fetchStockPhysicalSheet();
  const sheetCodes = Object.keys(stockMap);

  const items = await prisma.rawMaterial.findMany({
    select: { id: true, erpItemCode: true, availableStock: true },
  });

  const plan = planStockWrites(items, stockMap);

  // Writes are keyed on the primary key, never on the case-sensitive
  // erpItemCode — that mismatch is bug fix 1.
  const changed = plan.changed;

  let updatedRows = 0;
  let failedWrites = 0;

  if (!dryRun && changed.length > 0) {
    const limit = pLimit(concurrency);

    for (let i = 0; i < changed.length; i += CHUNK_SIZE) {
      const chunk = changed.slice(i, i + CHUNK_SIZE);

      const settled = await Promise.allSettled(
        chunk.map((row) =>
          limit(() =>
            prisma.gMDUpdateItem.update({
              where: { id: row.id },
              data: { availableStock: row.to },
            }),
          ),
        ),
      );

      settled.forEach((r, idx) => {
        if (r.status === "rejected") {
          failedWrites++;
          console.error(
            `[gmd-update-stock-phys] update failed id=${chunk[idx].id} code=${chunk[idx].erpItemCode} err=${(r.reason as Error)?.message}`,
          );
          return;
        }
        updatedRows++;
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log(
    `\n===== [SCHEDULER] STOCK-PHYS -> availableStock [${dryRun ? "DRY RUN" : "APPLY"}] =====`,
  );
  console.log(`[scheduler] stock-phys codes    : ${sheetCodes.length}`);
  console.log(`[scheduler] matched DB rows     : ${plan.matched.length}`);
  console.log(`[scheduler] rows to change      : ${changed.length}`);
  console.log(
    `[scheduler] rows already equal  : ${plan.matched.length - changed.length}`,
  );
  console.log(`[scheduler] rows written         : ${updatedRows}`);
  console.log(`[scheduler] DB rows not in sheet : ${plan.notInSheet}`);
  console.log(`[scheduler] blank cells skipped  : ${plan.skippedBlank}`);
  console.log(
    `[scheduler] sheet codes w/o DB row : ${plan.sheetCodesWithoutRow}`,
  );
  console.log(`[scheduler] failed writes        : ${failedWrites}`);
  console.log(`[scheduler] elapsed              : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] STOCK DONE =====\n");

  return {
    sheetCodes: sheetCodes.length,
    matched: plan.matched.length,
    changed: changed.length,
    unchanged: plan.matched.length - changed.length,
    updatedRows,
    notInSheet: plan.notInSheet,
    skippedBlank: plan.skippedBlank,
    sheetCodesWithoutRow: plan.sheetCodesWithoutRow,
    failedWrites,
    elapsedMs,
  };
}