/**
 * Scheduled job registry — one entry per ofelia-driven sync.
 *
 * Each job is a sequential pipeline of steps. `gmd-update` runs:
 *
 *   1. `runGmdCatalogueSync()`  GMD UPDATION -> GMDUpdateItem (create + diff)
 *   2. `runStockPhysSync()`     stock-phys   -> GMDUpdateItem.availableStock
 *
 * Step 2 only makes sense once step 1 has landed, so the steps are strictly
 * sequential: a fatal failure in step 1 aborts before step 2 runs rather than
 * refreshing stock against a half-synced table.
 *
 * All logic lives in this folder. `app/api/scheduler/**` contains nothing but
 * thin HTTP shims, because Next.js only routes `route.ts` files that sit under
 * `app/`.
 *
 * No module here imports from `@/app/actions` — that file is a `"use server"`
 * module and a route handler must not reach into one.
 */

import { runGmdCatalogueSync, type CatalogueSyncResult } from "./gmd-update-catalogue";
import {
  runStockPhysSync,
  type StockPhysSyncOptions,
  type StockPhysSyncResult,
} from "./gmd-update-stock-phys";

export type JobName = "gmd-update";

export type ScheduledJobResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    catalogue?: CatalogueSyncResult;
    stock?: StockPhysSyncResult;
  };
};

export type ScheduledJobError = {
  success: false;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  error: string;
  /** Whatever completed before the failure. */
  steps: ScheduledJobResult["steps"];
};

/**
 * Thrown when a job is asked to run while an earlier run of the same job is
 * still in flight. Shared by every scheduled job in this folder, so the
 * constructor takes any job name rather than one job's union.
 */
export class JobAlreadyRunningError extends Error {
  constructor(job: string) {
    super(`Job "${job}" is already running.`);
    this.name = "JobAlreadyRunningError";
  }
}

/**
 * In-process latch. Ofelia's `no-overlap = true` only stops ofelia jobs from
 * colliding with each other — it cannot stop a manual Sync button click (or a
 * second app instance sharing one database) from overlapping this run. A
 * second concurrent caller is rejected rather than queued.
 */
const inFlight = new Set<JobName>();

export type RunGmdUpdateOptions = {
  /** Forwarded to step 2 so a caller can preview without writing. */
  dryRunStock?: boolean;
  concurrency?: number;
};

/**
 * Runs the Raw Material scheduled sync end to end.
 *
 * Throws `JobAlreadyRunningError` if this job is already in flight; throws
 * whatever step 1 or step 2 threw on a fatal error. Callers translate that
 * into an HTTP status.
 */
export async function runScheduledGmdUpdate(
  options: RunGmdUpdateOptions = {},
): Promise<ScheduledJobResult> {
  const job: JobName = "gmd-update";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledJobResult["steps"] = {};

  try {
    console.log(
      `\n########## [SCHEDULER] ${job} start ${startedAt} ##########`,
    );

    // Step 1 — catalogue. A throw here skips step 2 entirely.
    steps.catalogue = await runGmdCatalogueSync(options.concurrency);

    // Step 2 — physical stock refresh.
    const stockOptions: StockPhysSyncOptions = {
      dryRun: options.dryRunStock ?? false,
    };
    if (options.concurrency !== undefined) {
      stockOptions.concurrency = options.concurrency;
    }
    steps.stock = await runStockPhysSync(stockOptions);

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `catalogue(created=${steps.catalogue.created}, updated=${steps.catalogue.updated}, unchanged=${steps.catalogue.unchanged}) ` +
        `stock(updated=${steps.stock.updatedRows}, changed=${steps.stock.changed})`,
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
    // Always release, so a throw does not wedge the next hourly run.
    inFlight.delete(job);
  }
}