/**
 * Scheduled job — BOM MAST ERP sync.
 *
 * A single-step job, so this orchestrator is thin. It still owns an in-flight
 * latch: ofelia's `no-overlap = true` cannot see a manual `POST
 * /api/sync/bom_from_erp` (or a second app instance) overlapping the same run.
 *
 * Scheduled at :05 — after `raw-material` (:00), whose RawMaterial rows the BOM
 * components resolve against, and before `supply-history` (:15), whose link
 * rebuild reads the `Bom`/`BomItem` graph this job writes.
 *
 * Not a Server Action path: all logic is action-free (`bom-mast-sync.ts`), so a
 * scheduled run can never be served a cached action result.
 */

import { runBomMastErpSync, type BomMastSyncResult } from "./bom-mast-sync";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "bom-mast";

export type ScheduledBomMastResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    bomMast?: BomMastSyncResult;
  };
};

const inFlight = new Set<JobName>();

export async function runScheduledBomMast(): Promise<ScheduledBomMastResult> {
  const job: JobName = "bom-mast";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledBomMastResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.bomMast = await runBomMastErpSync();

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `sheetRows=${steps.bomMast.sheetRows} distinctLinks=${steps.bomMast.distinctLinks} ` +
        `bomCreated=${steps.bomMast.bomCreated} linkCreated=${steps.bomMast.linkCreated} ` +
        `linkUnlinked=${steps.bomMast.linkUnlinked} unresolved=${steps.bomMast.unresolved}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}
