/**
 * Scheduled job — Supply History MASTER sync, then the sale-bill rate backfill.
 *
 * Two steps, in order: `runSupplyHistorySync()`, then `runSupplyRateBackfill()`
 * (gap-fill of `rate` and `value = quantity x rate`, which must run second so
 * MASTER's own `Value` column lands first).
 *
 * It still owns an in-flight latch: ofelia's `no-overlap = true` cannot see a
 * user clicking the manual Sync button, and the two would interleave writes over
 * the same table.
 *
 * Scheduled at :15, between `raw-material` (:00) and `contract-review` (:30).
 */

import { runSupplyHistorySync, type SupplyHistorySyncResult } from "./supply-history-sync";
import { JobAlreadyRunningError } from "./run-gmd-update";
import {
  runSupplyRateBackfill,
  type SupplyRateBackfillResult,
} from "@/lib/supplyRateBackfill";

export type JobName = "supply-history";

export type ScheduledSupplyHistoryResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    masterSync?: SupplyHistorySyncResult;
    /**
     * Gap-fill of `rate` (from the sale-bill tab) and `value = quantity x rate`.
     * Runs after `masterSync` so MASTER's own `Value` lands first and this only
     * fills what is still blank.
     */
    rateBackfill?: SupplyRateBackfillResult;
  };
  /** Set when the rate backfill failed; the MASTER sync still stands. */
  rateBackfillError?: string;
};

const inFlight = new Set<JobName>();

/**
 * Runs the Supply History MASTER sync.
 *
 * Throws `JobAlreadyRunningError` when already in flight; rethrows whatever the
 * step threw on a fatal error.
 */
export async function runScheduledSupplyHistory(): Promise<ScheduledSupplyHistoryResult> {
  const job: JobName = "supply-history";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledSupplyHistoryResult["steps"] = {};
  let rateBackfillError: string | undefined;

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.masterSync = await runSupplyHistorySync();

    // Gap-fills `rate` / `value`. A failure here must not undo the row sync, so
    // it is reported rather than thrown — the summary log makes it visible.
    try {
      steps.rateBackfill = await runSupplyRateBackfill();
    } catch (err) {
      rateBackfillError = err instanceof Error ? err.message : "Unknown error";
      console.error("[scheduler] supply-history rate backfill failed:", err);
    }

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `inserted=${steps.masterSync.inserted} patched=${steps.masterSync.patched} ` +
        `touched=${steps.masterSync.touched} failedWrites=${steps.masterSync.failedWrites}`,
    );
    if (rateBackfillError) {
      console.error(`[scheduler] ${job} rate backfill FAILED: ${rateBackfillError}`);
    } else if (steps.rateBackfill) {
      console.log(
        `[scheduler] ${job} rate backfill — rateFilled=${steps.rateBackfill.rateFilled} ` +
          `valueFilled=${steps.rateBackfill.valueFilled} ` +
          `unmatchedGroups=${steps.rateBackfill.groupsUnmatched} ` +
          `failedWrites=${steps.rateBackfill.failedWrites}`,
      );
    }
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps, rateBackfillError };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}