/**
 * Scheduled job 3 of 3 — "Sync RM AVAIL".
 *
 * Port of the button at `app/contract_review/page.tsx:2682-2695`, which calls
 * `syncContractReviewRmAvailAction` in `app/actions.ts:5178-5303`. That action is
 * a `"use server"` function, so it cannot be imported from a route handler — but
 * all of its logic already lives in action-free libs (`lib/verifyBomLookup.ts`
 * imports only `@/lib/prisma`; `lib/contractPhysicalStock.ts` imports nothing).
 * So this file calls those libs directly. **No logic is duplicated.**
 *
 * Three steps, in order:
 *   1. Refresh `RawMaterial.availableStock` from the stock-phys tab.
 *   2. Recompute `ContractReview.noUse` (the RM AVAIL column) from BOM availability.
 *   3. Push `ContractReview.rmPhysicalStock` (PHYSICAL STOCK) from stock-phys.
 *
 * Two deliberate changes from the button:
 *
 * 1. **Step 1 now overwrites instead of gap-filling.** The original only fills
 *    rows where `availableStock IS NULL OR ''` (`app/actions.ts:5198`), so stock
 *    is correct on the first run and permanently stale afterwards — useless on
 *    an hourly schedule. This version mirrors the policy chosen for the
 *    Raw Material job: overwrite when the sheet value differs, skip blanks so a
 *    blank cell can never clear a real value, and treat `"0"` as a real count.
 *    Note `RawMaterial` is a *different table* from `GMDUpdateItem`; this one is
 *    the one `getBomRmAvailBatch` reads through BomItem -> RawMaterial,
 *    so it is the one that has to stay fresh for RM AVAIL to mean anything.
 *
 * 2. **Step 2's transaction is chunked.** The original wraps every differing row
 *    in one unbounded `$transaction` (`app/actions.ts:5260`), which is a `P2028`
 *    waiting to happen. Here it is chunked at 200 with an explicit timeout.
 *
 * The stock-phys sheet is fetched exactly once and reused for steps 1 and 4,
 * as the original does — each fetch is 2 Google API calls.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { fetchStockPhysicalSheet } from "@/lib/gmd_lib/google-sheets";
import {
  getBomRmAvailBatch,
  computeContractReviewRmAvail,
} from "@/lib/verifyBomLookup";
import { planContractPhysicalStock } from "@/lib/contractPhysicalStock";

/** Rows per transaction, the Prisma transaction timeout, and write concurrency. */
const WRITE_CHUNK = 200;
const TX_TIMEOUT_MS = 20000;
const WRITE_CONCURRENCY = 10;

export type ContractReviewRmAvailResult = {
  /** Sheet codes read from stock-phys. */
  stockPhysCodes: number;
  /** RawMaterial rows whose stock was refreshed. */
  stockUpdated: number;
  /** Matched rows already equal to the sheet. */
  stockUnchanged: number;
  /** Sheet codes with a blank stock cell — skipped, never written. */
  stockSkippedBlank: number;
  /** RawMaterial rows whose code stock-phys does not mention — untouched. */
  stockNotInSheet: number;
  /** ContractReview rows whose RM AVAIL (noUse) changed. */
  rmAvailUpdated: number;
  /** ContractReview rows whose PHYSICAL STOCK changed. */
  physicalStockUpdated: number;
  /** Rows whose costCodeRef resolved to nothing, so PHYSICAL STOCK was cleared. */
  physicalStockCleared: number;
  failedWrites: number;
  elapsedMs: number;
};

export type ContractReviewRmAvailOptions = {
  dryRun?: boolean;
  concurrency?: number;
};

/**
 * Refreshes raw-material stock, VerifyBom, RM AVAIL and PHYSICAL STOCK.
 *
 * Throws on a fatal error (stock-phys unreachable, missing tab, DB down).
 * Per-row write failures are counted in `failedWrites`.
 */
export async function runContractReviewRmAvailSync(
  options: ContractReviewRmAvailOptions = {},
): Promise<ContractReviewRmAvailResult> {
  const { dryRun = false, concurrency = WRITE_CONCURRENCY } = options;
  const startedAt = Date.now();
  let failedWrites = 0;

  // One fetch (2 Google calls), reused by step 1 and step 4.
  const stockPhysMap = await fetchStockPhysicalSheet();
  const stockPhysCodes = Object.keys(stockPhysMap).length;

  /* ---------------------------------------------------------------- *
   * Step 1 — RawMaterial.availableStock from stock-phys
   * ---------------------------------------------------------------- */
  const rmRows = await prisma.rawMaterial.findMany({
    select: { id: true, erpItemCode: true, availableStock: true },
  });

  let stockSkippedBlank = 0;
  let stockNotInSheet = 0;
  const stockToWrite: { id: string; stock: string }[] = [];
  let stockUnchanged = 0;

  for (const row of rmRows) {
    const code = row.erpItemCode?.trim().toUpperCase();
    if (!code) continue;

    const raw = stockPhysMap[code];
    if (raw === undefined) {
      stockNotInSheet++;
      continue;
    }
    // A blank cell means "no count reported", not "zero stock" — never let it
    // clear a stored value. "0" is a real count and passes this check.
    if (raw.trim() === "") {
      stockSkippedBlank++;
      continue;
    }

    const stock = raw.trim();
    // Trimmed compare, so " 12 " vs "12" is not a false change.
    if ((row.availableStock ?? "").trim() === stock) {
      stockUnchanged++;
      continue;
    }
    stockToWrite.push({ id: row.id, stock });
  }

  if (!dryRun && stockToWrite.length > 0) {
    const limit = pLimit(concurrency);
    for (let i = 0; i < stockToWrite.length; i += WRITE_CHUNK) {
      const chunk = stockToWrite.slice(i, i + WRITE_CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((u) =>
          limit(() =>
            prisma.rawMaterial.update({
              where: { id: u.id },
              data: { availableStock: u.stock },
            }),
          ),
        ),
      );
      for (const r of settled) {
        if (r.status === "rejected") {
          failedWrites++;
          console.error(
            `[contract-review-rm-avail] rawMaterial update failed err=${(r.reason as Error)?.message}`,
          );
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Step 2 — RM AVAIL (ContractReview.noUse) for rows that have a bomId
   * ---------------------------------------------------------------- */
  const withBom = await tenderPrisma.contractReview.findMany({
    where: { bomId: { not: null } },
    select: { id: true, bomId: true, orderQty: true, noUse: true },
  });
  const bomIds = [
    ...new Set(withBom.map((i) => i.bomId).filter((b): b is string => !!b)),
  ];

  const bomAvail = await getBomRmAvailBatch(bomIds);
  const availMap = computeContractReviewRmAvail(
    withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
    bomAvail,
  );

  const rmAvailUpdates = withBom
    .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
    .map((i) => ({
      id: i.id,
      noUse: availMap.get(i.id) ?? null,
    }));

  if (!dryRun && rmAvailUpdates.length > 0) {
    for (let i = 0; i < rmAvailUpdates.length; i += WRITE_CHUNK) {
      const chunk = rmAvailUpdates.slice(i, i + WRITE_CHUNK);
      try {
        // Chunked, where the original used one unbounded transaction.
        await tenderPrisma.$transaction(
          chunk.map((u) =>
            tenderPrisma.contractReview.update({
              where: { id: u.id },
              data: { noUse: u.noUse },
            }),
          ),
          { timeout: TX_TIMEOUT_MS },
        );
      } catch (err) {
        failedWrites += chunk.length;
        console.error(
          `[contract-review-rm-avail] noUse chunk failed (${chunk.length} rows) err=${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Step 3 — PHYSICAL STOCK (ContractReview.rmPhysicalStock)
   * ---------------------------------------------------------------- */
  const physicalRows = await tenderPrisma.contractReview.findMany({
    select: { id: true, costCodeRef: true, rmPhysicalStock: true },
  });
  const physicalMap = planContractPhysicalStock(physicalRows, stockPhysMap);
  const physicalUpdates = physicalRows
    .filter((row) => (physicalMap.get(row.id) ?? null) !== row.rmPhysicalStock)
    .map((row) => ({
      id: row.id,
      value: physicalMap.get(row.id) ?? null,
    }));

  // A row whose costCodeRef resolves to nothing gets written null — i.e. a
  // previously-good value is cleared. Carried over from the original; counted
  // so it is visible rather than silent.
  const physicalStockCleared = physicalUpdates.filter(
    (u) => u.value === null && physicalRows.find((r) => r.id === u.id)?.rmPhysicalStock,
  ).length;

  if (!dryRun && physicalUpdates.length > 0) {
    for (let i = 0; i < physicalUpdates.length; i += WRITE_CHUNK) {
      const chunk = physicalUpdates.slice(i, i + WRITE_CHUNK);
      try {
        await tenderPrisma.$transaction(
          chunk.map((u) =>
            tenderPrisma.contractReview.update({
              where: { id: u.id },
              data: { rmPhysicalStock: u.value },
            }),
          ),
          { timeout: TX_TIMEOUT_MS },
        );
      } catch (err) {
        failedWrites += chunk.length;
        console.error(
          `[contract-review-rm-avail] rmPhysicalStock chunk failed (${chunk.length} rows) err=${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] CONTRACT REVIEW RM AVAIL =====");
  console.log(`[scheduler] mode                : ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`[scheduler] stock-phys codes    : ${stockPhysCodes}`);
  console.log(`[scheduler] rawMaterial stock   : updated=${stockToWrite.length} unchanged=${stockUnchanged} blankSkipped=${stockSkippedBlank} notInSheet=${stockNotInSheet}`);
  console.log(`[scheduler] RM AVAIL updated    : ${rmAvailUpdates.length}`);
  console.log(
    `[scheduler] PHYSICAL STOCK      : updated=${physicalUpdates.length} cleared=${physicalStockCleared}`,
  );
  console.log(`[scheduler] failed writes       : ${failedWrites}`);
  console.log(`[scheduler] elapsed              : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] RM AVAIL DONE =====\n");

  return {
    stockPhysCodes,
    stockUpdated: stockToWrite.length,
    stockUnchanged,
    stockSkippedBlank,
    stockNotInSheet,
    rmAvailUpdated: rmAvailUpdates.length,
    physicalStockUpdated: physicalUpdates.length,
    physicalStockCleared,
    failedWrites,
    elapsedMs,
  };
}