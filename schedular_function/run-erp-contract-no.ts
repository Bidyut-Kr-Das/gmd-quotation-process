/**
 * Scheduled job — ERP Contract No sync.
 *
 * Runs at :50 of every even hour, after `execution-tracking` (:40) has written
 * the `SupplyHistoryItem` rows for a new invoice, and after `supply-history`
 * (:15) has written the MASTER rows. It fills or corrects `erpContractNo` from
 * `MC.CONTRACT_VRNO`, keyed on `SALE BILL.ORDER_VRNO = MC.VRNO`.
 *
 * Note `erpContractNo` has two writers: the `supply-history` job writes the
 * MASTER `ERP CONTRACT NO` value, and this job writes MC's contract. Measured on
 * FY 2026-27 they agree on every comparable row (254/254), so there is no
 * flip-flop today — but `overwrittenRows` in the report is the signal to watch if
 * MASTER ever carries a different spelling.
 *
 * The in-flight latch matters: ofelia's `no-overlap = true` cannot see a manual
 * CLI run, and this job and a `npm run contractno:sync --apply` write the same
 * column — an overlap would interleave writes from the same starting state.
 */

import { JobAlreadyRunningError } from "./run-gmd-update";
import {
  runErpContractNoStep,
  type ErpContractNoStepResult,
} from "./erp-contract-no-sync";

export type JobName = "erp-contract-no";

export type ScheduledErpContractNoResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    erpContractNo?: ErpContractNoStepResult;
  };
};

const inFlight = new Set<JobName>();

export type RunErpContractNoOptions = {
  /** Count and report without writing anything. */
  dryRun?: boolean;
  /** Override the fiscal year. Defaults to the current one. */
  financialYear?: string;
};

/**
 * Fills `SupplyHistoryItem.erpContractNo` from the MC tab for one fiscal year.
 *
 * Throws `JobAlreadyRunningError` when this job is already in flight, and
 * rethrows a fatal error (workbook/columns/DB unreachable). Per-invoice write
 * failures surface in `steps.erpContractNo.sync.failedWrites` rather than failing
 * the run.
 */
export async function runScheduledErpContractNo(
  options: RunErpContractNoOptions = {},
): Promise<ScheduledErpContractNoResult> {
  const job: JobName = "erp-contract-no";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledErpContractNoResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.erpContractNo = await runErpContractNoStep({
      dryRun: options.dryRun,
      financialYear: options.financialYear,
    });

    const elapsedMs = Date.now() - startedAtMs;
    const sync = steps.erpContractNo.sync;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — fy=${sync.financialYear} ` +
        `invoices=${sync.scanned} rows=${sync.rowsWritten} ` +
        `fill=${sync.filledRows} overwrite=${sync.overwrittenRows} ` +
        `unchangedInvoices=${sync.unchangedInvoices} failedWrites=${sync.failedWrites}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next scheduled run.
    inFlight.delete(job);
  }
}
