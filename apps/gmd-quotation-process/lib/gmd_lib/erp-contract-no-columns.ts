/**
 * Execution Tracking workbook -> `SupplyHistoryItem.erpContractNo`.
 *
 * Source workbook: `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` (the same file the
 * execution-tracking sync reads). Two tabs, both resolved by **gid**, never by
 * title, so renaming a tab cannot silently redirect the read:
 *
 *   `SALE_BILL_GID` -> the invoice lines. `VRNO` is the invoice number (the same
 *     key the execution-tracking sync uses) and `ORDER_VRNO` is the ERP order the
 *     invoice was raised against. `ACC_YEAR` scopes the read to one fiscal year.
 *
 *   `MC_GID` -> the material-contract tab. `VRNO` is the order number and
 *     `CONTRACT_VRNO` the contract it was converted from. **Measured on the live
 *     tab: 708 distinct `VRNO`, and none carries more than one `CONTRACT_VRNO`**,
 *     so the order -> contract lookup is 1:1 and the sync works at invoice level.
 *
 * The join is `SALE BILL.ORDER_VRNO = MC.VRNO -> MC.CONTRACT_VRNO`, written to
 * `SupplyHistoryItem.erpContractNo`.
 *
 * The MC tab's first column (A) carries no header. Columns are resolved by name
 * via `findColumn`, never by position, so a leading column cannot shift the read.
 *
 * Write policy (see `lib/erpContractNoSync.ts` for the full account):
 *   - a blank MC `CONTRACT_VRNO` never clears a stored value;
 *   - nothing is ever deleted.
 */

/** Canonical headers of the MC tab. */
export const MC_KEY_HEADERS = {
  /** The order number. Half of the sheet join key. */
  vrno: "VRNO",
  /** The contract the order was converted from — the value written to the DB. */
  contractVrno: "CONTRACT_VRNO",
} as const;

/**
 * SALE BILL's order column. `SALE_BILL_KEY_HEADERS.invoiceNo` (`VRNO`) is the
 * invoice; this is the order the invoice was raised against, which is what MC
 * keys its `CONTRACT_VRNO` on.
 */
export const SALE_BILL_TARGET_HEADERS = {
  orderVrno: "ORDER_VRNO",
} as const;

function requireGid(envVar: string): number {
  const raw = process.env[envVar];
  const gid = Number(raw);
  if (!raw || !Number.isInteger(gid)) {
    throw new Error(
      `${envVar} is not configured on the server (got ${JSON.stringify(raw)}).`,
    );
  }
  return gid;
}

/** `MC_GID` — the order -> contract tab. */
export function mcGid(): number {
  return requireGid("MC_GID");
}
