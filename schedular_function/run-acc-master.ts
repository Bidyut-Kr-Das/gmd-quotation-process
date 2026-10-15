/**
 * Scheduled job — ACC_MASTER refresh.
 *
 * A single-step job, so this orchestrator is thin. It still owns an in-flight
 * latch: ofelia's `no-overlap = true` cannot see the manual path, and the
 * execution-tracking step also refreshes this table before it runs.
 *
 * Runs at :35, after the heavy jobs and before `execution-tracking` (:40), which
 * is the job that reads what this one writes.
 */

import { JobAlreadyRunningError } from "./run-gmd-update";
import { runAccMasterSync, type AccMasterSyncResult } from "./acc-master-sync";

export type JobName = "acc-master";

export type ScheduledAccMasterResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    accMaster?: AccMasterSyncResult;
  };
};

const inFlight = new Set<JobName>();

export type RunAccMasterOptions = {
  /** Count and report without writing anything. */
  dryRun?: boolean;
};

/**
 * Copies the ACC_MASTER tab into `acc_master`.
 *
 * Throws `JobAlreadyRunningError` when already in flight; rethrows whatever the
 * step threw on a fatal error. A failed row write is counted in
 * `steps.accMaster.failedWrites` and the run still reports `success: true`.
 */
export async function runScheduledAccMaster(
  options: RunAccMasterOptions = {},
): Promise<ScheduledAccMasterResult> {
  const job: JobName = "acc-master";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledAccMasterResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.accMaster = await runAccMasterSync({ dryRun: options.dryRun ?? false });

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — created=${steps.accMaster.created} ` +
        `updated=${steps.accMaster.updated} unchanged=${steps.accMaster.unchanged} ` +
        `failedWrites=${steps.accMaster.failedWrites}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    inFlight.delete(job);
  }
}
