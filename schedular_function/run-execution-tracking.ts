/**
 * Scheduled job — Execution Tracking sync.
 *
 * Runs at :40, after `acc-master` (:35) has refreshed the code -> name list, and
 * after `supply-history` (:15) has written the MASTER rows this sync patches.
 *
 * The in-flight latch matters twice over here: ofelia's `no-overlap = true`
 * cannot see the FY-dropdown button on `/supply_history`, and this job and that
 * button write the same `SupplyHistoryItem` columns — an overlap would interleave
 * diffs computed from the same starting state.
 */

import { JobAlreadyRunningError } from "./run-gmd-update";
import {
  runExecutionTrackingStep,
  type ExecutionTrackingStepResult,
} from "./execution-tracking-sync";

export type JobName = "execution-tracking";

export type ScheduledExecutionTrackingResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    executionTracking?: ExecutionTrackingStepResult;
  };
};

const inFlight = new Set<JobName>();

export type RunExecutionTrackingOptions = {
  /** Count and report without writing anything. */
  dryRun?: boolean;
  /** Override the fiscal year. Defaults to the current one. */
  financialYear?: string;
};

/**
 * Diffs the execution-tracking tab into `SupplyHistoryItem` for one fiscal year.
 *
 * Throws `JobAlreadyRunningError` when this job is already in flight, and
 * rethrows a fatal error (workbook/columns/DB unreachable). Per-row write
 * failures surface in `steps.executionTracking.sync.failedWrites` rather than
 * failing the run.
 */
export async function runScheduledExecutionTracking(
  options: RunExecutionTrackingOptions = {},
): Promise<ScheduledExecutionTrackingResult> {
  const job: JobName = "execution-tracking";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledExecutionTrackingResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.executionTracking = await runExecutionTrackingStep({
      dryRun: options.dryRun,
      financialYear: options.financialYear,
    });

    const elapsedMs = Date.now() - startedAtMs;
    const sync = steps.executionTracking.sync;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — fy=${sync.financialYear} ` +
        `inserted=${sync.inserted} updated=${sync.updated} unchanged=${sync.unchanged} ` +
        `ambiguous=${sync.ambiguous} failedWrites=${sync.failedWrites}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}
