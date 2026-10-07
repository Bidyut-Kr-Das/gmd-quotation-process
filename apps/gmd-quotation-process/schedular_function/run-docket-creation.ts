/**
 * Scheduled job — pending docket creation.
 *
 * A single-step job, so this orchestrator is thin. It still owns an in-flight
 * latch, because ofelia's `no-overlap = true` cannot see a second app instance
 * (or a future manual caller) sharing one database; a concurrent run would
 * allocate the same docket serials twice.
 *
 * Scheduled at :20, between `supply-history` (:15) and `contract-review` (:30),
 * so contract-review's same-hour pass can backfill `contractNo` on the dockets
 * this job creates.
 */

import { runPendingDocketCreation, type PendingDocketCreationResult } from "./docket-creation";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "docket-creation";

export type ScheduledDocketCreationResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    creation?: PendingDocketCreationResult;
  };
};

const inFlight = new Set<JobName>();

export type RunDocketCreationOptions = {
  /** Plan and report without writing anything. */
  dryRun?: boolean;
};

/**
 * Materializes dockets for every `DocketQuotationThread` flagged
 * `pendingDocket = true`.
 *
 * A per-docket failure is counted in `steps.creation.failed` and the job still
 * reports `success: true` for the dockets that did land — inspect `failed`
 * rather than the status code alone. A fatal error (the pending query throws)
 * propagates.
 */
export async function runScheduledDocketCreation(
  options: RunDocketCreationOptions = {},
): Promise<ScheduledDocketCreationResult> {
  const job: JobName = "docket-creation";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledDocketCreationResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.creation = await runPendingDocketCreation({ dryRun: options.dryRun ?? false });

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — pending=${steps.creation.pending} ` +
        `created=${steps.creation.created} failed=${steps.creation.failed} ` +
        `snapshotFailures=${steps.creation.snapshotFailures}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}
