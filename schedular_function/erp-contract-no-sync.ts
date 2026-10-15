/**
 * Scheduled step — MC.CONTRACT_VRNO -> SupplyHistoryItem.erpContractNo.
 *
 * Reads the `SALE_BILL_GID` and `MC_GID` tabs of
 * `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` and writes the contract the ERP order
 * was converted from onto every row of the matched invoice, for one fiscal year.
 *
 * The fiscal year is derived from today's date with the same helper the docket
 * numbering uses (April start), which is the `2026-27` form `SupplyHistoryItem`
 * stores. The manual CLI passes `--fy` instead.
 *
 * Runs after `execution-tracking` (:40 of even hours) so rows that job just
 * inserted for a new invoice are picked up in the same 2-hourly pass.
 */

import { getFiscalYearLabel } from "@/lib/docketNumber";
import {
  runErpContractNoSync,
  type ErpContractNoReport,
} from "@/lib/erpContractNoSync";

export type ErpContractNoStepOptions = {
  /** Report without writing anything. */
  dryRun?: boolean;
  /** Override the fiscal year (any spelling). Defaults to the current one. */
  financialYear?: string;
};

export type ErpContractNoStepResult = {
  financialYear: string;
  sync: ErpContractNoReport;
};

export async function runErpContractNoStep(
  options: ErpContractNoStepOptions = {},
): Promise<ErpContractNoStepResult> {
  const dryRun = options.dryRun ?? false;
  const financialYear = options.financialYear ?? getFiscalYearLabel(new Date());

  const sync = await runErpContractNoSync({
    financialYear,
    apply: !dryRun,
  });

  return { financialYear: sync.financialYear, sync };
}
