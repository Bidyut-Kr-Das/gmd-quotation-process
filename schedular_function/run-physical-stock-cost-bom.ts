/**
 * Scheduled job — Physical Stock cost / BOM ID derivation.
 *
 * Single step: `applyPhysicalStockDerivations()` (`lib/gmd_lib/physical-stock-derive.ts`),
 * which recomputes `cost` / `bom_id` for every row of the PhysicalStock table.
 *
 * Reads the BOM graph from the LOCAL database (candidate BOMs = those owned by
 * the `FullItem` whose `itemCode` = the row's `erp_code`, unioned with BOMs that
 * consume the code as a component; effective cost = owning `FullItem.cost`,
 * which a DB trigger keeps at `MAX(BomItem.cost)`, else `RawMaterial.cost`) and
 * writes only `cost` / `bom_id` back to the NEON PhysicalStock table.
 *
 * This is therefore a CROSS-DATABASE step: read local, write Neon. There is no
 * shared transaction; the operation is idempotent and safe to re-run. An
 * existing `bom_id` is preserved while it is still a valid candidate, otherwise
 * the highest-cost BOM becomes the default. No other column is ever touched.
 *
 * Scheduled at :10 — after `bom-mast` (:05), whose `FullItem` / `Bom` / `BomItem`
 * rows this step reads, and before `supply-history` (:15). It writes only Neon,
 * so it contends with no other job for the local database.
 *
 * A single-step job still owns an in-flight latch: ofelia's `no-overlap = true`
 * cannot see a manual `POST /api/scheduler/physical-stock-cost-bom` (or a second
 * app instance) overlapping the same run.
 */

import { applyPhysicalStockDerivations } from "@/lib/gmd_lib/physical-stock-derive";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "physical-stock-cost-bom";

export type PhysicalStockDeriveResult = {
  /** Rows scanned in the Neon PhysicalStock table. */
  scanned: number;
  /** Rows whose cost / bom_id actually changed. */
  updated: number;
};

export type ScheduledPhysicalStockCostBomResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    derive?: PhysicalStockDeriveResult;
  };
};

const inFlight = new Set<JobName>();

export async function runScheduledPhysicalStockCostBom(): Promise<ScheduledPhysicalStockCostBomResult> {
  const job: JobName = "physical-stock-cost-bom";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledPhysicalStockCostBomResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.derive = await applyPhysicalStockDerivations();

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `scanned=${steps.derive.scanned} updated=${steps.derive.updated}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}
