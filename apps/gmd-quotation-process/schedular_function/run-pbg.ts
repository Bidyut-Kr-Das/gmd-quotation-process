/**
 * Scheduled job — PBG sheet sync.
 *
 * Single step: `syncPbgData()` (`lib/pbg/pbg-data.ts`), the same function the
 * dashboard's Sync button calls (`syncPbgDataAction`), so the two paths cannot
 * drift.
 *
 * Reads the PBG sheet tab and upserts ONLY the sheet-owned columns, keyed on the
 * BG number: `BG_NO`, `BG_AMT`, `CANCELLED_STATUS`, `MARGIN %`, `MARGIN_AMT`
 * and `BENEFICIARY_NAME` → `clientName`. A BG number absent from the DB is
 * inserted; an existing row is updated only where the sheet value is non-blank
 * and differs. A blank (`-`, `--`) never clears a stored value. Nothing is ever
 * deleted, and every other column (PO no., PO date, bankGuarantee, validityOn,
 * …) is left untouched.
 *
 * Run by ofelia on `@every 1h12m` (72 minutes), a cadence a plain cron cannot
 * express. Safe to overlap: `pbgData` is written by no other scheduled job.
 *
 * A single-step job still owns an in-flight latch: ofelia's `no-overlap = true`
 * cannot see a user clicking the manual Sync button (or a second app instance)
 * overlapping the same run.
 */

import { syncPbgData, type PbgSyncResult } from "@/lib/pbg/pbg-data";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "pbg";

export type ScheduledPbgResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    sync?: PbgSyncResult;
  };
};

const inFlight = new Set<JobName>();

export async function runScheduledPbg(): Promise<ScheduledPbgResult> {
  const job: JobName = "pbg";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledPbgResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.sync = await syncPbgData();

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `inserted=${steps.sync.inserted} updated=${steps.sync.updated} ` +
        `unchanged=${steps.sync.unchanged} skippedBlankBgNo=${steps.sync.skippedBlankBgNo}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}
