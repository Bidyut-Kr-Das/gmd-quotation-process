/**
 * Scheduled job — Contract Review, five steps in order.
 *
 *   1.  `runContractReviewSheetSync()`     CONTRACTS + DUMP -> ContractReview
 *   1b. `runContractReviewItemNameSync()`  ITEM MASTER ERP -> ContractReview.itemName
 *   2.  `runContractReviewEnquirySync()`   Enquiry -> State / Utility / Project Ref
 *   3.  `runContractReviewRmAvailSync()`   stock-phys -> VerifyBom -> RM AVAIL -> PHYSICAL STOCK
 *   4.  `runIcDumpSync()`                  INSPECTION OFFER DUMP -> offer / inspection / DI
 *
 * The order is a real dependency chain, not cosmetic:
 *   - 2 depends on 1 for fresh contract rows to match Enquiry against.
 *   - 3 step 3 reads VerifyBom, whose `itemName` is sourced from
 *     `ContractReview.itemName` ordered by `syncedAt desc`
 *     (`lib/verifyBomLookup.ts:236`), so 1b runs before 3 to make the ITEM
 *     MASTER name available. `ContractReview.itemName` is in the sheet sync's
 *     SKIP_FIELDS, so only 1b writes it.
 *   - 3 step 4 needs `ContractReview.costCodeRef`, which job 1 cannot populate
 *     (it is absent from CONTRACTS_SHEET_COLUMNS) and which is published
 *     separately from the Indent Listing by `recomputeIndentListingVersionsAction`.
 *     If that has never run, step 4 resolves nothing and writes null.
 *   - 4 joins on `mcNo` + `itemCode`, both of which step 1 is what populates.
 *
 * Steps are strictly sequential. A fatal failure aborts the remaining steps
 * rather than running them against a half-updated table.
 *
 * Step 2 is normally a no-op: step 1 already applies the identical backfill
 * (`app/api/contract-review/sync/route.ts:233-234`). It is kept as its own step
 * because it is cheap and independently useful; `steps.enquiry.noOp` makes the
 * redundancy visible instead of silent.
 *
 * Note the work is split so that nothing runs twice per hour: VerifyBom and the
 * RM AVAIL recompute are owned by step 3 only, even though the manual SYNC route
 * also performs them.
 */

import { runContractReviewSheetSync, type ContractReviewSyncResult } from "./contract-review-sync";
import { runContractReviewItemNameSync, type ItemNameSyncResult } from "./item-name-sync";
import {
  runContractReviewEnquirySync,
  type ContractReviewEnquiryResult,
} from "./contract-review-enquiry";
import {
  runContractReviewRmAvailSync,
  type ContractReviewRmAvailResult,
} from "./contract-review-rm-avail";
import { runIcDumpSync, type IcDumpSyncResult } from "./contract-review-ic-dump";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "contract-review";

export type ScheduledContractReviewResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    sheetSync?: ContractReviewSyncResult;
    itemNames?: ItemNameSyncResult;
    enquiry?: ContractReviewEnquiryResult;
    rmAvail?: ContractReviewRmAvailResult;
    icDump?: IcDumpSyncResult;
  };
};

/**
 * Separate latch from the Raw Material job's, so the two heavy jobs can be
 * scheduled without one blocking the other — but this job still refuses to
 * overlap itself (ofelia's `no-overlap` cannot see a manual button click).
 */
const inFlight = new Set<JobName>();

export type RunContractReviewOptions = {
  /** Compute and report without writing. Applies to steps 2, 3 and 4. */
  dryRun?: boolean;
  concurrency?: number;
};

/**
 * Runs the Contract Review scheduled sync end to end.
 *
 * Throws `JobAlreadyRunningError` when already in flight, and rethrows whatever
 * a step threw on a fatal error.
 */
export async function runScheduledContractReview(
  options: RunContractReviewOptions = {},
): Promise<ScheduledContractReviewResult> {
  const job: JobName = "contract-review";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledContractReviewResult["steps"] = {};
  const { dryRun = false } = options;

  try {
    console.log(
      `\n########## [SCHEDULER] ${job} start ${startedAt} ##########`,
    );

    // Step 1 — sheet sync. A throw here skips both remaining steps.
    steps.sheetSync = await runContractReviewSheetSync();

    // Step 1b — item names from ITEM MASTER ERP. Runs before RM AVAIL, which
    // sources VerifyBom.itemName from ContractReview.itemName.
    steps.itemNames = await runContractReviewItemNameSync();

    // Step 2 — enquiry fields.
    steps.enquiry = await runContractReviewEnquirySync({ dryRun });

    // Step 3 — RM AVAIL / VerifyBom / physical stock.
    const rmAvailOptions = { dryRun };
    if (options.concurrency !== undefined) {
      Object.assign(rmAvailOptions, { concurrency: options.concurrency });
    }
    steps.rmAvail = await runContractReviewRmAvailSync(rmAvailOptions);

    // Step 4 — INSPECTION OFFER DUMP -> offer / inspection / DI. Needs the
    // `mcNo` + `itemCode` pair that step 1 produced.
    steps.icDump = await runIcDumpSync({ dryRun });

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `sheet(created=${steps.sheetSync.created}, updated=${steps.sheetSync.updated}, unchanged=${steps.sheetSync.unchanged}) ` +
        `itemNames(updated=${steps.itemNames.updated}, unmatched=${steps.itemNames.unmatched}) ` +
        `enquiry(changed=${steps.enquiry.changed}) ` +
        `rmAvail(stock=${steps.rmAvail.stockUpdated}, noUse=${steps.rmAvail.rmAvailUpdated}, physical=${steps.rmAvail.physicalStockUpdated}) ` +
        `icDump(matched=${steps.icDump.matched}, updated=${steps.icDump.rowsToUpdate}, written=${steps.icDump.written})`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return {
      success: true,
      job,
      startedAt,
      elapsedMs,
      steps,
    };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}