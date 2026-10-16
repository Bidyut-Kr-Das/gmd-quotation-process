/**
 * Scheduled step — Execution Tracking -> SupplyHistoryItem.
 *
 * Two moves, in order:
 *
 *   1. `runAccMasterSync()` refreshes the local `acc_master` list, so the
 *      consignee names the diff writes are current for this run. The hourly
 *      `acc-master` job at :35 is the same refresh; doing it here as well is
 *      what makes the *manual* button safe, and it is one small tab.
 *      A failure is logged and the step continues — a stale name list is better
 *      than no sync, and `accMapSize` / `accMisses` in the report make it
 *      visible instead of silent.
 *
 *   2. `runExecutionTrackingSync()` diffs the `SALE_BILL_GID` tab for the
 *      current fiscal year, or for a year passed in.
 *
 * The fiscal year is derived from today's date with the same helper the docket
 * numbering uses (April start), which is the `2026-27` form `SupplyHistoryItem`
 * stores. The manual path passes a year chosen in the UI instead.
 */

import { getFiscalYearLabel } from "@/lib/docketNumber";
import {
  runExecutionTrackingSync,
  type ExecutionTrackingReport,
} from "@/lib/executionTrackingSync";
import { runAccMasterSync, type AccMasterSyncResult } from "./acc-master-sync";

export type ExecutionTrackingStepOptions = {
  /** Report without writing anything, including the ACC master refresh. */
  dryRun?: boolean;
  /** Override the fiscal year (any spelling). Defaults to the current one. */
  financialYear?: string;
};

export type ExecutionTrackingStepResult = {
  financialYear: string;
  /** `null` when the ACC master refresh failed and was skipped. */
  accMaster: AccMasterSyncResult | null;
  accMasterDegraded: boolean;
  sync: ExecutionTrackingReport;
};

export async function runExecutionTrackingStep(
  options: ExecutionTrackingStepOptions = {},
): Promise<ExecutionTrackingStepResult> {
  const dryRun = options.dryRun ?? false;

  let accMaster: AccMasterSyncResult | null = null;
  let accMasterDegraded = false;
  try {
    accMaster = await runAccMasterSync({ dryRun });
  } catch (err) {
    accMasterDegraded = true;
    console.error(
      "[execution-tracking] ACC master refresh failed, continuing with the stored list:",
      err,
    );
  }

  const financialYear = options.financialYear ?? getFiscalYearLabel(new Date());

  const sync = await runExecutionTrackingSync({
    financialYear,
    apply: !dryRun,
  });

  return {
    financialYear: sync.financialYear,
    accMaster,
    accMasterDegraded,
    sync,
  };
}
