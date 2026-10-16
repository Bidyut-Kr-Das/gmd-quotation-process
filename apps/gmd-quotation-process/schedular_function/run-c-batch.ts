/**
 * Scheduled job — C Batch marks.
 *
 * A single-step job, so this orchestrator is thin. It still owns an in-flight
 * latch, because ofelia's `no-overlap = true` cannot see a user clicking the
 * "Sync C Batch" button on `/data-sources`.
 *
 * Scheduled at :45, last of the four hourly jobs. Overlap with another job is
 * safe by construction: this one writes only the `cBatch` column, and no other
 * scheduled job touches it.
 */

import { runCBatchSync, type CBatchSyncResult } from "./c-batch";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "c-batch";

export type ScheduledCBatchResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    cBatch?: CBatchSyncResult;
  };
};

const inFlight = new Set<JobName>();

export type RunCBatchOptions = {
  /** Count and report without writing anything. */
  dryRun?: boolean;
};

/**
 * Marks `cBatch = "C"` across the four tables from ITEM MASTER ERP.
 *
 * A table that fails outright is recorded in `steps.cBatch.failedTables` and the
 * job still reports `success: true` for the tables that did apply — inspect
 * `failedTables` rather than the status code alone. A fatal error (sheet
 * unreachable, missing tab/column) throws.
 */
export async function runScheduledCBatch(
  options: RunCBatchOptions = {},
): Promise<ScheduledCBatchResult> {
  const job: JobName = "c-batch";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledCBatchResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.cBatch = await runCBatchSync({ dryRun: options.dryRun ?? false });

    const elapsedMs = Date.now() - startedAtMs;
    const total = steps.cBatch.perTable.reduce((n, t) => n + t.rowsUpdated, 0);

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — updated=${total} ` +
        `failedTables=${steps.cBatch.failedTables.length ? steps.cBatch.failedTables.join(",") : "none"}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    inFlight.delete(job);
  }
}