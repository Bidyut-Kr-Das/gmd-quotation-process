/**
 * Scheduled job — Supply History MASTER sync.
 *
 * A single-step job, so this orchestrator is thin. It still owns an in-flight
 * latch: ofelia's `no-overlap = true` cannot see a user clicking the manual Sync
 * button, and the two would interleave writes over the same table.
 *
 * Scheduled at :15, between `raw-material` (:00) and `contract-review` (:30).
 */

import { runSupplyHistorySync, type SupplyHistorySyncResult } from "./supply-history-sync";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "supply-history";

export type ScheduledSupplyHistoryResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    masterSync?: SupplyHistorySyncResult;
  };
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

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.masterSync = await runSupplyHistorySync();

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `inserted=${steps.masterSync.inserted} patched=${steps.masterSync.patched} ` +
        `touched=${steps.masterSync.touched} failedWrites=${steps.masterSync.failedWrites}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}