/**
 * Execution Tracking workbook -> SupplyHistoryItem.
 *
 * Source workbook: `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` (the same file as
 * the BOM MAST ERP workbook). Two tabs, both resolved by **gid**, never by
 * title, so renaming a tab cannot silently redirect the read:
 *
 *   `ACC_MASTER_GID` -> ACC_CODE / ACC_NAME. The code -> account-name list the
 *     join needs. Copied into the local `acc_master` table by the `acc-master`
 *     job; this sync reads the table, not the tab.
 *
 *   `SALE_BILL_GID` -> the per-invoice execution rows. Each row is matched to a
 *     `SupplyHistoryItem` by invoice number and diffed.
 *
 * Adding a column later is **one line** in `SALE_BILL_COLUMN_MAP`: the engine's
 * preload, insert payload, diff loop, dry-run report and unit test all iterate
 * that list, so a new mapping propagates without touching any of them.
 *
 * Write policy (see `lib/executionTrackingSync.ts` for the full account):
 *   - a blank cell — including the `-` `--` `—` `–` sentinels — never clears a
 *     stored value;
 *   - `state` is written only when the sheet value is a recognised Indian
 *     state, normalised to the DB's Title Case (`West Bengal`);
 *   - nothing is ever deleted.
 */

import { BOM_MAST_ERP_SPREADSHEET_ID } from "./bomMastErp";

/** Canonical header of the ACC_MASTER tab. Confirmed with the sheet owner. */
export const ACC_MASTER_HEADERS = {
  code: "ACC_CODE",
  name: "ACC_NAME",
} as const;

/** Headers of the SALE_BILL tab that are not part of the value mapping. */
export const SALE_BILL_KEY_HEADERS = {
  /** VRNO — the invoice number. First half of the match key. */
  invoiceNo: "VRNO",
  /**
   * The account code used to resolve the consignee name from ACC_MASTER /
   * `acc_master`. It is SALE BILL's **`ACC_CODE`** (column B), deliberately, per
   * the sheet owner.
   *
   * The tab also carries a `CONSIGNEE_CODE` column, and the two mean different
   * things: `ACC_CODE` is the **billed party**, `CONSIGNEE_CODE` is the **ship-to**
   * party. They differ on 357 of the 5,117 rows. Whichever is chosen, the name
   * lands in `SupplyHistoryItem.consigneeName` either way.
   */
  accountCode: "ACC_CODE",
  /**
   * The fiscal year column, `ACC_YEAR` on the live sheet (values `25-26`,
   * `26-27` — the short label), while `SupplyHistoryItem` stores the four-digit
   * form (`2026-27`). The value is normalised — see `normalizeFiscalYear`. The
   * other names are accepted so a renamed column does not silently stop the
   * filter; `FY`/`FINANCIAL YEAR` are the names the MASTER sheet uses.
   */
  financialYearAliases: ["ACC_YEAR", "FY", "FINANCIAL YEAR"],
} as const;

/** Fields of `SupplyHistoryItem` this sync owns. */
export type SaleBillField =
  | "quantity"
  | "uom"
  | "lrNoDt"
  | "state"
  | "consigneeAddress"
  | "erpItemCode";

/**
 * SALE_BILL column -> SupplyHistoryItem field, in the order they appear on the
 * sheet. Append to this list to map another column; nothing else needs editing.
 */
export const SALE_BILL_COLUMN_MAP: readonly { sheet: string; db: SaleBillField }[] = [
  { sheet: "QTYISSUED", db: "quantity" },
  { sheet: "UM", db: "uom" },
  { sheet: "LRNO", db: "lrNoDt" },
  { sheet: "CONSG_STATE_NAME", db: "state" },
  { sheet: "CONSIGNEE_ADD", db: "consigneeAddress" },
  { sheet: "ITEM_CODE", db: "erpItemCode" },
];

/**
 * `consigneeName` is not on the sheet: it is `ACC_NAME` for the row's account
 * code (`SALE_BILL_KEY_HEADERS.accountCode`), resolved through `acc_master`.
 */
export const CONSIGNEE_NAME_FIELD = "consigneeName" as const;

/** The workbook id, with the hard-coded workbook as the fallback. */
export function executionTrackingSpreadsheetId(): string {
  return (
    process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID ??
    BOM_MAST_ERP_SPREADSHEET_ID
  );
}

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

/** `ACC_MASTER_GID` — the code -> account-name tab. */
export function accMasterGid(): number {
  return requireGid("ACC_MASTER_GID");
}

/** `SALE_BILL_GID` — the execution rows tab. */
export function saleBillGid(): number {
  return requireGid("SALE_BILL_GID");
}

const DASH_SENTINELS = new Set(["-", "--", "—", "–"]);

/**
 * True for a cell that carries no information: empty, whitespace, or one of the
 * dash sentinels the sheets use for "not applicable". Such a value must never
 * clear a stored one.
 */
export function isBlankSheetValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || DASH_SENTINELS.has(trimmed);
}

/** Trim + collapse whitespace + upper-case, for keys that are compared. */
export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Fiscal year to the four-digit form the DB stores: `26-27`, `2026-27`,
 * `2026-2027` and `2627` all become `2026-27`. Returns `null` for anything that
 * does not look like a fiscal year, so a junk cell is skipped rather than
 * matching the wrong rows.
 */
export function normalizeFiscalYear(raw: unknown): string | null {
  const text = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/^FY[\s:.-]*/, "");
  if (!text) return null;

  const digits = text.replace(/[^0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const parts = digits.split("-").filter(Boolean);

  let startRaw: string | null = null;
  if (parts.length === 2) {
    startRaw = parts[0];
  } else if (parts.length === 1 && parts[0].length === 4) {
    // "2627" -> start 26, end 27
    startRaw = parts[0].slice(0, 2);
  }
  if (!startRaw) return null;

  const start = Number(startRaw.length === 2 ? `20${startRaw}` : startRaw);
  if (!Number.isInteger(start) || start < 1900 || start > 2999) return null;

  return `${start}-${String(start + 1).slice(-2)}`;
}

/**
 * Spellings of a fiscal year that may already be in the DB, for a SQL `IN`.
 * `financialYear` is free text, so older rows are not guaranteed to use the
 * four-digit form; the query casts a wide net and `normalizeFiscalYear` decides.
 */
export function fiscalYearVariants(financialYear: string): string[] {
  const canonical = normalizeFiscalYear(financialYear);
  if (!canonical) return [String(financialYear).trim()].filter(Boolean);

  const [startStr, endShort] = canonical.split("-");
  const start = Number(startStr);
  return [
    canonical,
    `${startStr.slice(-2)}-${endShort}`,
    `${start}-${start + 1}`,
    `${startStr.slice(-2)}${endShort}`,
    `${startStr.slice(-2)}_${endShort}`,
  ];
}
