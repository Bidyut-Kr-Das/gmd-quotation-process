/**
 * Scheduled job 2 of 3 — "Sync Enquiry Fields".
 *
 * Backfills `ContractReview.state` / `.utility` / `.projectReference` from the
 * matching Enquiry by contract number. Port of the button at
 * `app/contract_review/page.tsx:3374-3387`, which calls
 * `syncContractReviewEnquiryFieldsAllAction` in `app/actions.ts:3766`.
 *
 * That action is a `"use server"` function in a `"use server"` module, so it
 * cannot be imported from a route handler. But it is already a thin wrapper —
 * every line of real logic lives in `lib/gmd_lib/contract-review-enquiry-backfill.ts`,
 * which has no `@/app/actions` import. So this file calls the same two lib
 * functions directly. **No logic is duplicated.**
 *
 * NOTE — this is normally a no-op when run right after job 1.
 * `app/api/contract-review/sync/route.ts:233-234` already calls the identical
 * pair of lib functions, so by the time this job runs the diff is normally
 * `changed === 0`. It is kept as its own step because it is cheap (two queries,
 * zero writes in steady state) and because it is independently useful when the
 * sheet sync is skipped. The result reports `changed` so a surprise non-zero
 * is visible rather than silent.
 *
 * Semantics carried over unchanged, and worth knowing: a ContractReview row
 * whose `contractNo` matches no Enquiry gets all three fields set to `null`.
 * This is the only code path in the repo that blanks these columns.
 */

import { prisma } from "@/lib/prisma";
import {
  computeContractReviewEnquiryBackfill,
  applyContractReviewEnquiryBackfill,
} from "@/lib/gmd_lib/contract-review-enquiry-backfill";

export type ContractReviewEnquiryResult = {
  /** ContractReview rows whose contractNo matched an Enquiry. */
  matched: number;
  /** Rows whose three fields differ from the Enquiry. */
  changed: number;
  /** Rows with no matching Enquiry — these get the fields set to null. */
  unmatched: number;
  /** Rows actually written. Equals `changed` unless `dryRun` is set. */
  updated: number;
  dryRun: boolean;
  /** True when job 1 had already applied the same backfill this run. */
  noOp: boolean;
  elapsedMs: number;
};

export type ContractReviewEnquiryOptions = {
  /** Compute and report the diff without writing anything. */
  dryRun?: boolean;
};

/**
 * Recomputes State / Utility / Project Reference from Enquiry.
 *
 * Throws on a fatal error; the lib applies in 500-row transactions so a
 * mid-way failure leaves earlier chunks committed.
 */
export async function runContractReviewEnquirySync(
  options: ContractReviewEnquiryOptions = {},
): Promise<ContractReviewEnquiryResult> {
  const { dryRun = false } = options;
  const startedAt = Date.now();

  const result = await computeContractReviewEnquiryBackfill(prisma);
  const updated = dryRun ? 0 : await applyContractReviewEnquiryBackfill(prisma, result.rows);
  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] CONTRACT REVIEW ENQUIRY FIELDS =====");
  console.log(`[scheduler] mode        : ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`[scheduler] matched     : ${result.matched}`);
  console.log(`[scheduler] changed     : ${result.changed}`);
  console.log(`[scheduler] unmatched   : ${result.unmatched}`);
  console.log(`[scheduler] updated     : ${updated}`);
  if (result.changed === 0) {
    console.log(
      "[scheduler] note        : no-op — job 1 already applies this backfill",
    );
  }
  console.log(`[scheduler] elapsed     : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] ENQUIRY DONE =====\n");

  return {
    matched: result.matched,
    changed: result.changed,
    unmatched: result.unmatched,
    updated,
    dryRun,
    noOp: result.changed === 0,
    elapsedMs,
  };
}