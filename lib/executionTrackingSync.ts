/**
 * Execution Tracking -> SupplyHistoryItem.
 *
 * The one engine behind all three entry points:
 *   - `scripts/sync-execution-tracking.ts` (`npm run exec:sync`, dry run by
 *     default, `--limit` for a smoke test),
 *   - `POST /api/supply-history/execution-sync` (the button's FY dropdown),
 *   - the `execution-tracking` scheduler job (current fiscal year).
 *
 * Source: the `SALE_BILL_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`.
 * `CONSIGNEE_ADD` and friends come straight off the row; `consigneeName` is
 * resolved through the local `acc_master` table (see `lib/accMasterLookup.ts`),
 * which the callers refresh first.
 *
 * ── The sheet is a line ledger, the table is one row per (invoice, item) ──
 *
 * Measured on FY 2026-27: the sheet's 487 rows are 401 distinct
 * `(VRNO, ITEM_CODE)` pairs over 138 invoices — the same code is listed more
 * than once on an invoice (31 of those groups), because the sheet records each
 * issue line. `SupplyHistoryItem` holds **one** row per `(invoiceNo,
 * erpItemCode)`: that pair is unique in the year (0 duplicates), and the row's
 * `quantity` is the **sum** of the sheet's lines — verified on all 320 pairs the
 * two share, with zero exceptions.
 *
 * So the sync **merges the sheet's lines per `(invoiceNo, ITEM_CODE)` and sums
 * `QTYISSUED`** before diffing. Taking the first line instead would have written
 * `96` over a stored `627` (GD26Y-00014, three lines: 96 + 106 + 425) — a silent
 * regression in 23 of the 320 rows, which is exactly what the smoke test caught.
 *
 * ── Matching ──
 *
 * Exact `(invoiceNo, erpItemCode)`, which the data supports. A group with no
 * item code on the sheet falls back to matching by invoice number alone, and is
 * counted as `ambiguous` when that invoice owns several DB rows — writing one
 * line's quantity onto its siblings is worse than skipping, so it is not done.
 *
 * ── Write policy ──
 *
 *   - `quantity`, `uom`, `lrNoDt`, `consigneeAddress`, `erpItemCode` and
 *     `consigneeName` are overwritten when the sheet value is non-blank and
 *     differs. Blank cells — including `-` `--` `—` `–` — never clear a value.
 *   - `state` is written **only** when the sheet value is a recognised Indian
 *     state, and written in the DB's Title Case. Comparison is on the canonical
 *     form, so a row that already means the same thing (`Chattisgarh` vs
 *     `CHATTISGARH`) is never rewritten. An unrecognised value leaves the field
 *     alone and is counted in `stateSkipped`.
 *   - a pair the table does not hold is **inserted**. `itemName` comes from
 *     `resolveItemNames` (`lib/erpItemNameLookup.ts`) — the name the item was
 *     supplied under before, else the ERP master name. Only when no source knows
 *     the code does it stay blank, and that is counted in `unnamedInserts`. An
 *     insert whose resolved name collides with a row the invoice already has is
 *     counted in `blockedInserts` (the DB unique key is `(invoiceNo, itemName)`).
 *   - `invoiceNo`, `itemName`, `financialYear` are never overwritten on an
 *     existing row. Nothing is ever deleted. `syncedAt` is stamped only on rows
 *     actually written.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { cell, findColumn, readSheetTabByGid, requireColumns } from "@/lib/gmd_lib/bomMastErp";
import {
  CONSIGNEE_NAME_FIELD,
  SALE_BILL_COLUMN_MAP,
  SALE_BILL_KEY_HEADERS,
  executionTrackingSpreadsheetId,
  fiscalYearVariants,
  isBlankSheetValue,
  normalizeFiscalYear,
  normalizeKey,
  saleBillGid,
  type SaleBillField,
} from "@/lib/gmd_lib/execution-tracking-columns";
import { getAccNameMap } from "@/lib/accMasterLookup";
import { resolveItemNames, resolveMasterNames } from "@/lib/erpItemNameLookup";
import { canonicalizeState } from "@/lib/supplyStateResolver";
import {
  SYNC_LOG_KIND,
  writeSyncLog,
  type SyncLogChange,
  type SyncLogFieldChange,
} from "@/lib/syncLog";

/** Rows per write chunk, and how many may be in flight at once. */
const WRITE_CHUNK = 200;
const WRITE_CONCURRENCY = 10;

/** Inline console samples; the full diff lives in `sync_log.details`. */
const SAMPLE_SIZE = 5;

/** Every field this sync owns, in report order. */
const OWNED_FIELDS: readonly string[] = [
  ...SALE_BILL_COLUMN_MAP.map((m) => m.db),
  CONSIGNEE_NAME_FIELD,
];

export type ExecutionTrackingOptions = {
  /**
   * The fiscal year to sync. Any spelling is accepted — `26-27`, `2026-27`,
   * `2026-2027` — and normalised to the four-digit form the DB stores.
   */
  financialYear: string;
  /** Write. `false` (the default) reports what would change and touches nothing. */
  apply?: boolean;
  /** Only consider the first N merged rows for the year. For a smoke test. */
  limit?: number;
  /** Write a `sync_log` row. Default true, including for a dry run. */
  log?: boolean;
};

/** One sheet row, reduced to the fields this sync cares about. */
export type SheetLine = {
  invoiceNo: string;
  /** Raw account code (`SALE_BILL_KEY_HEADERS.accountCode`). */
  accountCode: string;
  /** Non-blank sheet values only. */
  values: Partial<Record<SaleBillField, string>>;
};

/** A sheet row that has been folded with its siblings. */
export type MergedLine = SheetLine & {
  /** How many sheet lines were folded in. */
  lines: number;
  /**
   * Item codes folded into this row by `mergeByDescription`, when several codes
   * share one description on the same invoice. Empty/absent otherwise.
   */
  foldedCodes?: string[];
};

/** A merged line with the lookups applied, ready to diff. */
export type MappedRecord = MergedLine & {
  /** Canonical `YYYY-YY` target. */
  financialYear: string;
  /** `ACC_NAME` for the code, or `null` when the code is blank/unmatched. */
  consigneeName: string | null;
  /** The code was present but is not in `acc_master`. */
  accMiss: boolean;
  /** Raw state cell, for the unrecognised-state report. */
  stateRaw: string | null;
  /** Canonical Title Case state, or `null` when unrecognised. */
  stateCanonical: string | null;
};

/** The columns preloaded from `SupplyHistoryItem`. */
export type DbRow = {
  id: string;
  invoiceNo: string | null;
  itemName: string | null;
  quantity: string | null;
  uom: string | null;
  lrNoDt: string | null;
  state: string | null;
  consigneeAddress: string | null;
  erpItemCode: string | null;
  consigneeName: string | null;
};

export type ExecutionTrackingReport = {
  mode: "dry-run" | "apply";
  /** Canonical, e.g. `2026-27`. */
  financialYear: string;
  financialYearInput: string;
  tabTitle: string;
  /** Data rows on the tab. */
  sheetRows: number;
  /** Rows whose own FY column equals the target. */
  sheetRowsForFy: number;
  /** Distinct `(invoice, item code)` groups in the year. */
  sheetGroups: number;
  /** Groups actually considered, after `limit`. */
  scanned: number;
  /** Groups that folded more than one sheet line. */
  mergedGroups: number;
  /** Sheet lines folded away by the merge. */
  mergedLines: number;
  /** Rows folded because several item codes share one description on an invoice. */
  mergedDescriptionGroups: number;
  /** Details of those folds, for the report and the log. */
  descriptionMerges: DescriptionMerge[];
  /**
   * Stored names refreshed so a colliding insert could land — the row that held
   * the name was renamed to its item code's current name.
   */
  nameRefreshes: number;
  nameRefreshSamples: string[];
  /** Groups resolved to exactly one DB row. */
  matched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Rows skipped for a blank invoice number. */
  skippedBlankInvoice: number;
  /** Inserts refused: the invoice already has a row under that item name. */
  blockedInserts: number;
  /** Inserts with no name known for the item code, so `itemName` stayed blank. */
  unnamedInserts: number;
  /** One invoice, several DB rows, no item code to split them — never written. */
  ambiguous: number;
  /** `acc_master` rows available to resolve names. */
  accMapSize: number;
  /** Records whose consignee code is not in `acc_master`. */
  accMisses: number;
  accMissSamples: string[];
  /** Sheet states that are not a recognised Indian state, so were left alone. */
  stateSkipped: number;
  stateSkippedSamples: string[];
  failedWrites: number;
  /** Every added/changed row, capped by `DETAIL_CAP` when written to the log. */
  changes: SyncLogChange[];
  sampleChanges: string[];
  logId: string | null;
  elapsedMs: number;
};

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toNumber(value: unknown): number | null {
  const parsed = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Format a summed quantity without float noise (`0.1 + 0.2` -> `"0.3"`). */
function formatQuantity(sum: number): string {
  return String(Number(sum.toFixed(6)));
}

/**
 * Folds the sheet's lines into one row per `(invoiceNo, ITEM_CODE)`.
 *
 * `QTYISSUED` is **summed** — the table stores the invoice's total for that item
 * code, which is what the lines add up to (verified on all 320 shared pairs of
 * FY 2026-27). If any line's quantity is not a number the first non-blank value
 * is kept instead of a sum, so a text cell is never swallowed. Every other field
 * takes the first non-blank value in the group.
 *
 * Split out from the DB work so the merge can be tested without a database.
 */
export function mergeSheetLines(lines: readonly SheetLine[]): MergedLine[] {
  const groups = new Map<
    string,
    {
      line: SheetLine;
      lines: number;
      quantities: number[];
      quantityFallback: string | null;
      nonNumericQuantity: boolean;
    }
  >();

  for (const line of lines) {
    const key = `${normalizeKey(line.invoiceNo)}||${normalizeKey(line.values.erpItemCode ?? "")}`;
    const existing = groups.get(key);

    const quantity = line.values.quantity;
    if (existing) {
      existing.lines++;
      if (isBlankSheetValue(quantity)) {
        // nothing to add
      } else {
        const parsed = toNumber(quantity);
        if (parsed === null) {
          existing.nonNumericQuantity = true;
          existing.quantityFallback ??= String(quantity).trim();
        } else {
          existing.quantities.push(parsed);
        }
      }
      // first non-blank wins for every other field
      for (const [field, value] of Object.entries(line.values)) {
        if (field === "quantity") continue;
        if (isBlankSheetValue(existing.line.values[field as SaleBillField])) {
          existing.line.values[field as SaleBillField] = value;
        }
      }
      if (!existing.line.accountCode) existing.line.accountCode = line.accountCode;
      continue;
    }

    const record = {
      line: { ...line, values: { ...line.values } },
      lines: 1,
      quantities: [] as number[],
      quantityFallback: null as string | null,
      nonNumericQuantity: false,
    };
    if (!isBlankSheetValue(quantity)) {
      const parsed = toNumber(quantity);
      if (parsed === null) {
        record.nonNumericQuantity = true;
        record.quantityFallback = String(quantity).trim();
      } else {
        record.quantities.push(parsed);
      }
    }
    groups.set(key, record);
  }

  const merged: MergedLine[] = [];
  for (const record of groups.values()) {
    const values = { ...record.line.values };
    if (record.quantities.length > 0 && !record.nonNumericQuantity) {
      values.quantity = formatQuantity(
        record.quantities.reduce((sum, value) => sum + value, 0),
      );
    } else if (record.quantityFallback) {
      values.quantity = record.quantityFallback;
    }
    merged.push({
      invoiceNo: record.line.invoiceNo,
      accountCode: record.line.accountCode,
      values,
      lines: record.lines,
    });
  }
  return merged;
}

/** One description-level fold, for the report and the log. */
export type DescriptionMerge = {
  invoiceNo: string;
  description: string;
  /** The item code that survived, first in sheet order. */
  keptCode: string;
  /** The item codes folded into it, in sheet order. */
  foldedCodes: string[];
  /** The combined quantity written to the surviving row. */
  quantity: string | null;
  /** Sheet lines involved, across every folded code. */
  lines: number;
};

/**
 * Folds rows that carry **different item codes but the same item description** on
 * one invoice into a single row, adding their quantities.
 *
 * Why this is needed: the table's identity is `(invoiceNo, itemName)` — a
 * *description*, not a code. Two codes can share a description (measured:
 * `FSD040113` and `FSD040050` both read `SLUICE VALVE-...-STANDARD_65_PN-10/16`
 * on `GD26Y-00126`), and the table can hold only one of them per invoice. Rather
 * than lose the second, its quantity is added to the survivor — exactly what
 * happens when the same code is listed twice.
 *
 * **The key is the ERP master name** (`masterNameByCode`, from
 * `resolveMasterNames`), never the stored supply name. That distinction matters:
 * `FVC030011` (`..._150_...`) and `FVC030012` (`..._200_...`) are different
 * products whose *stored* names both read `..._200` because one is mislabelled.
 * Folding on the stored name merged a 150 mm into a 200 mm, and a gear box into
 * an O-ring. Folding on the master name leaves those alone while still folding
 * the genuine duplicates. A row whose code has no master name is never folded —
 * there is no trustworthy key for it.
 *
 * Only folds when **everything except the quantity and the item code is the
 * same** (uom, LR, canonical state, consignee address, account code). If those
 * differ, the two rows are genuinely different entries and are left alone for the
 * normal refusal path.
 *
 * Pure: no database access, so the rule is unit-tested directly.
 */
export function mergeByDescription(
  lines: readonly MergedLine[],
  masterNameByCode: Map<string, string>,
  options: { existingPairs?: Set<string> } = {},
): { lines: MergedLine[]; merges: DescriptionMerge[] } {
  const existingPairs = options.existingPairs ?? new Set<string>();
  const groups = new Map<string, MergedLine[]>();
  const order: string[] = [];
  const ungrouped: MergedLine[] = [];

  for (const line of lines) {
    const code = normalizeKey(line.values.erpItemCode ?? "");
    const description = code ? normalizeKey(masterNameByCode.get(code) ?? "") : "";
    if (!description) {
      ungrouped.push(line);
      continue;
    }
    // Everything the DB would store, except the quantity and the code itself.
    const signature = [
      normalizeKey(line.accountCode),
      normalizeKey(line.values.uom ?? ""),
      normalizeKey(line.values.lrNoDt ?? ""),
      normalizeKey(line.values.state ?? ""),
      normalizeKey(line.values.consigneeAddress ?? ""),
    ].join("||");
    const key = `${normalizeKey(line.invoiceNo)}||${description}||${signature}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(line);
  }

  const out: MergedLine[] = [...ungrouped];
  const merges: DescriptionMerge[] = [];

  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    // Deterministic survivor: prefer a code the invoice **already has a row for**,
    // so the fold lands as an update on that row instead of a second insert that
    // would double-count the quantity. Among equals, the lowest code — so the
    // same pair always folds the same way rather than following sheet order.
    const isExisting = (line: MergedLine) =>
      existingPairs.has(
        `${normalizeKey(line.invoiceNo)}||${normalizeKey(line.values.erpItemCode ?? "")}`,
      );
    const ordered = [...group].sort((a, b) => {
      const aExists = isExisting(a) ? 0 : 1;
      const bExists = isExisting(b) ? 0 : 1;
      if (aExists !== bExists) return aExists - bExists;
      return normalizeKey(a.values.erpItemCode ?? "").localeCompare(
        normalizeKey(b.values.erpItemCode ?? ""),
      );
    });

    const first = ordered[0];
    const foldedCodes = ordered
      .slice(1)
      .map((line) => line.values.erpItemCode ?? "")
      .filter(Boolean);

    const quantities = ordered
      .map((line) => line.values.quantity)
      .filter((quantity) => !isBlankSheetValue(quantity)) as string[];
    const numbers = quantities.map((quantity) => toNumber(quantity));
    const allNumeric = numbers.every((value) => value !== null);
    const quantity =
      quantities.length === 0
        ? null
        : allNumeric
          ? formatQuantity(numbers.reduce((sum, value) => sum + (value as number), 0))
          : String(quantities[0]).trim();

    const values = { ...first.values };
    if (quantity === null) delete values.quantity;
    else values.quantity = quantity;

    // `lines` stays the code-level count, so the two folding layers are reported
    // separately rather than mixing into `mergedGroups` / `mergedLines`.
    out.push({ ...first, values, foldedCodes });

    merges.push({
      invoiceNo: first.invoiceNo,
      description: masterNameByCode.get(normalizeKey(first.values.erpItemCode ?? "")) ?? "",
      keptCode: first.values.erpItemCode ?? "",
      foldedCodes,
      quantity,
      lines: ordered.reduce((total, line) => total + line.lines, 0),
    });
  }

  return { lines: out, merges };
}

/**
 * Picks the DB row a record belongs to.
 *
 * With an item code on the sheet the match is exact — `(invoiceNo, erpItemCode)`
 * — and no match means a genuine new line, so it returns `null` and the caller
 * inserts. Several DB rows for the same pair (7 such pairs exist in the whole
 * table, none in this year) are reported rather than guessed at.
 *
 * Without an item code the invoice number is all there is: one DB row matches,
 * several are `ambiguous`. That is the one case where writing could clobber a
 * sibling line, so it is refused.
 */
export function pickDbRow(
  pairCandidates: DbRow[],
  invoiceCandidates: DbRow[],
  record: MappedRecord,
): { row: DbRow | null; ambiguous: boolean } {
  const code = normalizeKey(record.values.erpItemCode ?? "");
  if (code) {
    if (pairCandidates.length === 1) return { row: pairCandidates[0], ambiguous: false };
    if (pairCandidates.length > 1) return { row: null, ambiguous: true };
    return { row: null, ambiguous: false }; // new line -> insert
  }

  if (invoiceCandidates.length === 0) return { row: null, ambiguous: false };
  if (invoiceCandidates.length === 1) return { row: invoiceCandidates[0], ambiguous: false };
  return { row: null, ambiguous: true };
}

/**
 * The field-level diff for one record.
 *
 * `row === null` means "insert", so every non-blank sheet value is a change from
 * nothing. An empty result on an existing row means "unchanged".
 */
export function computeFieldChanges(
  record: MappedRecord,
  row: DbRow | null,
): { changes: SyncLogFieldChange[]; stateSkipped: boolean } {
  const changes: SyncLogFieldChange[] = [];
  let stateSkipped = false;

  const consider = (field: string, next: string) => {
    const current = row ? trimmedOrNull((row as unknown as Record<string, unknown>)[field]) : null;
    if (current === next) return;
    changes.push({ field, from: current, to: next });
  };

  for (const field of OWNED_FIELDS) {
    if (field === "state") {
      if (!record.stateRaw) continue;
      if (!record.stateCanonical) {
        stateSkipped = true;
        continue;
      }
      // Compare on the canonical form so a spelling variant is not a change.
      const current = canonicalizeState(row?.state ?? null);
      if (current === record.stateCanonical) continue;
      changes.push({
        field: "state",
        from: row?.state ?? null,
        to: record.stateCanonical,
      });
      continue;
    }

    const next =
      field === CONSIGNEE_NAME_FIELD
        ? record.consigneeName
        : (record.values[field as SaleBillField] ?? null);
    if (!next) continue; // blank never overwrites
    consider(field, next);
  }

  return { changes, stateSkipped };
}

export type NameRefreshPlan = {
  /** The DB row to rename. */
  id: string;
  /** The item code of that row, for the log. */
  blockerCode: string;
  /** Its stored name now. */
  from: string;
  /** Its item code's current name — the name it should be under. */
  to: string;
};

/**
 * Decides whether a stored name can be refreshed to free the name a new row needs.
 *
 * Reusable by design: this is the repair for "the invoice already has a row with
 * that description", and it is what makes the fix hold on later runs instead of
 * being a one-off edit.
 *
 * The situation it repairs: a row is stored under an **older description than its
 * own item code uses everywhere else**. On `GD26Y-00055` the `FSD040001` row sits
 * under `SLUICE VALVE-...-STANDARD_100_PN-10/16` — the description the ERP master
 * gives `FRD020002` — while every other `FSD040001` row in the table reads
 * `Sluice Valve Ductile Iron Resilient Seated PN 1.0 HW OP. 100 MM`. Refreshing it
 * to its own current name frees the other code's name, and both lines land.
 *
 * Refuses (returns `null`) when:
 *   - there is no stored row holding the name;
 *   - that row was already refreshed in this run;
 *   - its item code has no known current name, or the current name **is** the
 *     name we want to free (renaming would collide again immediately);
 *   - the invoice already uses the current name on another row.
 *
 * Pure and synchronous: everything it needs is passed in, so the rule is tested
 * directly.
 */
export function planNameRefresh(params: {
  blocker: { row: DbRow; code: string } | null;
  desiredName: string;
  desiredCode: string;
  nameByCode: Map<string, string>;
  takenNameKeys: Set<string>;
  invoiceKey: string;
  alreadyRefreshed: Set<string>;
}): NameRefreshPlan | null {
  const { blocker, desiredName, desiredCode, nameByCode, takenNameKeys, invoiceKey, alreadyRefreshed } =
    params;

  if (!blocker) return null;
  if (alreadyRefreshed.has(blocker.row.id)) return null;

  const from = String(blocker.row.itemName ?? "").trim();
  const to = String(nameByCode.get(blocker.code) ?? "").trim();
  if (!from || !to) return null;

  // Renaming to the same string would leave the name just as taken.
  if (normalizeKey(to) === normalizeKey(desiredName)) return null;

  // The row we would rename must not be the row we are inserting.
  if (normalizeKey(blocker.row.erpItemCode ?? "") === normalizeKey(desiredCode)) return null;

  // The invoice must not already carry that name on another row.
  if (takenNameKeys.has(`${invoiceKey}||${normalizeKey(to)}`)) return null;

  return { id: blocker.row.id, blockerCode: blocker.row.erpItemCode ?? "", from, to };
}

/** The `create` payload for a record that has no DB row yet. */
function buildInsert(
  record: MappedRecord,
  itemName: string,
  syncedAt: Date,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    invoiceNo: record.invoiceNo,
    itemName,
    financialYear: record.financialYear,
    syncedAt,
  };
  for (const field of OWNED_FIELDS) {
    if (field === "state") {
      if (record.stateCanonical) data.state = record.stateCanonical;
      continue;
    }
    if (field === CONSIGNEE_NAME_FIELD) {
      if (record.consigneeName) data[CONSIGNEE_NAME_FIELD] = record.consigneeName;
      continue;
    }
    const value = record.values[field as SaleBillField];
    if (value) data[field] = value;
  }
  return data;
}

/**
 * Reads the tab and diffs it into `SupplyHistoryItem`.
 *
 * Throws on a fatal error: a missing env var, an unreachable workbook, a renamed
 * column, or the DB being down. Per-row write failures are counted, not thrown.
 */
export async function runExecutionTrackingSync(
  options: ExecutionTrackingOptions,
): Promise<ExecutionTrackingReport> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs);
  const apply = options.apply ?? false;

  const financialYearInput = String(options.financialYear ?? "").trim();
  const financialYear = normalizeFiscalYear(financialYearInput);
  if (!financialYear) {
    throw new Error(
      `Not a fiscal year: ${JSON.stringify(options.financialYear)}. Expected something like 2026-27 or 26-27.`,
    );
  }

  const spreadsheetId = executionTrackingSpreadsheetId();
  const gid = saleBillGid();
  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, gid);

  // Fail fast on a renamed column: silently skipping a mapping is how a sync
  // stops updating without anyone noticing.
  const mappedSheetHeaders = SALE_BILL_COLUMN_MAP.map((m) => m.sheet);
  const [invoiceNoIdx, accountCodeIdx, ...fieldIdx] = requireColumns(
    headers,
    [
      SALE_BILL_KEY_HEADERS.invoiceNo,
      SALE_BILL_KEY_HEADERS.accountCode,
      ...mappedSheetHeaders,
    ],
    tabTitle,
  );

  const fyIdx = SALE_BILL_KEY_HEADERS.financialYearAliases
    .map((alias) => findColumn(headers, alias))
    .find((idx) => idx >= 0);
  if (fyIdx === undefined) {
    throw new Error(
      `Sheet "${tabTitle}" has no fiscal-year column (looked for: ${SALE_BILL_KEY_HEADERS.financialYearAliases.join(", ")}).`,
    );
  }

  const accMap = await getAccNameMap();
  if (accMap.size === 0) {
    console.warn(
      "[execution-tracking] acc_master is empty — consignee names cannot be resolved. " +
        "Run the acc-master refresh first (schedular_function/acc-master-sync.ts).",
    );
  }

  // ── Read the sheet for the year, then fold its lines ──
  const sheetLines: SheetLine[] = [];
  const accMissSamples: string[] = [];
  let sheetRowsForFy = 0;
  let skippedBlankInvoice = 0;

  for (const row of rows) {
    const rowFy = normalizeFiscalYear(cell(row, fyIdx));
    if (rowFy !== financialYear) continue;
    sheetRowsForFy++;

    const invoiceNo = cell(row, invoiceNoIdx);
    if (!invoiceNo) {
      skippedBlankInvoice++;
      continue;
    }

    const values: Partial<Record<SaleBillField, string>> = {};
    SALE_BILL_COLUMN_MAP.forEach((mapping, i) => {
      const raw = cell(row, fieldIdx[i]);
      if (isBlankSheetValue(raw)) return;
      values[mapping.db] = raw;
    });

    sheetLines.push({ invoiceNo, accountCode: cell(row, accountCodeIdx), values });
  }

  const mergedLines = mergeSheetLines(sheetLines);

  // Descriptions, resolved once for every code in play:
  //   - `nameByCode`     the name a row is stored under (supply first).
  //   - `masterNameByCode` the ERP master name, used only to decide whether two
  //     codes are really the same product (see `mergeByDescription`).
  const codesInPlay = mergedLines
    .map((line) => line.values.erpItemCode ?? "")
    .filter(Boolean);
  const [nameByCode, masterNameByCode] = await Promise.all([
    resolveItemNames(codesInPlay),
    resolveMasterNames(codesInPlay),
  ]);

  // ── Preload the year from the DB ──
  //
  // Read before folding: the fold prefers a surviving code the invoice already
  // has a row for, so it folds into an update instead of inserting a second row
  // that would double-count the quantity.
  const dbRows = (await prisma.supplyHistoryItem.findMany({
    where: { financialYear: { in: fiscalYearVariants(financialYear) } },
    select: {
      id: true,
      invoiceNo: true,
      itemName: true,
      quantity: true,
      uom: true,
      lrNoDt: true,
      state: true,
      consigneeAddress: true,
      erpItemCode: true,
      consigneeName: true,
    },
  })) as DbRow[];

  const byPair = new Map<string, DbRow[]>();
  const byInvoice = new Map<string, DbRow[]>();
  for (const dbRow of dbRows) {
    const invoiceKey = normalizeKey(dbRow.invoiceNo ?? "");
    if (!invoiceKey) continue;
    const invoiceList = byInvoice.get(invoiceKey);
    if (invoiceList) invoiceList.push(dbRow);
    else byInvoice.set(invoiceKey, [dbRow]);

    const code = normalizeKey(dbRow.erpItemCode ?? "");
    if (!code) continue;
    const pairKey = `${invoiceKey}||${code}`;
    const pairList = byPair.get(pairKey);
    if (pairList) pairList.push(dbRow);
    else byPair.set(pairKey, [dbRow]);
  }

  // Every `(invoiceNo, itemName)` the table already holds, so an insert can be
  // checked against the DB unique key before it is attempted.
  const takenNameKeys = new Set<string>();
  for (const row of await prisma.supplyHistoryItem.findMany({
    select: { invoiceNo: true, itemName: true },
  })) {
    takenNameKeys.add(`${normalizeKey(row.invoiceNo)}||${normalizeKey(row.itemName)}`);
  }

  // ── Fold rows that share an ERP master description though their codes differ ──
  const { lines: foldedLines, merges: descriptionMerges } = mergeByDescription(
    mergedLines,
    masterNameByCode,
    { existingPairs: new Set(byPair.keys()) },
  );

  const records: MappedRecord[] = foldedLines.map((line) => {
    const accountCode = line.accountCode;
    const accName = accountCode ? accMap.get(normalizeKey(accountCode)) : undefined;
    const accMiss = Boolean(accountCode) && !accName;
    if (accMiss && accMissSamples.length < SAMPLE_SIZE) accMissSamples.push(accountCode);

    const stateRaw = line.values.state ?? null;
    return {
      ...line,
      financialYear,
      consigneeName: accName ?? null,
      accMiss,
      stateRaw,
      stateCanonical: stateRaw ? canonicalizeState(stateRaw) : null,
    };
  });

  const limited =
    typeof options.limit === "number" && options.limit >= 0
      ? records.slice(0, options.limit)
      : records;

  // ── Classify ──
  const syncedAt = new Date();
  const toUpdate: { id: string; data: Record<string, unknown>; debug: string[] }[] = [];
  const pendingInserts: { record: MappedRecord; changes: SyncLogFieldChange[] }[] = [];
  const changes: SyncLogChange[] = [];
  const stateSkippedSamples: string[] = [];

  let matched = 0;
  let unchanged = 0;
  let ambiguous = 0;
  let stateSkipped = 0;
  let mergedGroups = 0;
  let mergedLineCount = 0;

  for (const record of limited) {
    if (record.lines > 1) {
      mergedGroups++;
      mergedLineCount += record.lines - 1;
    }

    const invoiceKey = normalizeKey(record.invoiceNo);
    const code = normalizeKey(record.values.erpItemCode ?? "");
    const pairCandidates = code ? (byPair.get(`${invoiceKey}||${code}`) ?? []) : [];
    const invoiceCandidates = byInvoice.get(invoiceKey) ?? [];

    const { row: dbRow, ambiguous: isAmbiguous } = pickDbRow(
      pairCandidates,
      invoiceCandidates,
      record,
    );
    if (isAmbiguous) {
      ambiguous++;
      changes.push({
        key: `${record.invoiceNo}${code ? ` / ${record.values.erpItemCode}` : ""}`,
        action: "skipped",
        fields: [],
        reason: code
          ? "the DB holds more than one row for this invoice and item code"
          : "the invoice owns several DB rows and the sheet line carries no item code",
      });
      continue;
    }

    const { changes: fieldChanges, stateSkipped: skippedState } = computeFieldChanges(record, dbRow);
    if (skippedState) {
      stateSkipped++;
      if (stateSkippedSamples.length < SAMPLE_SIZE && record.stateRaw) {
        stateSkippedSamples.push(record.stateRaw);
      }
    }

    if (!dbRow) {
      pendingInserts.push({ record, changes: fieldChanges });
      continue;
    }

    matched++;
    if (fieldChanges.length === 0) {
      unchanged++;
      continue;
    }

    const data: Record<string, unknown> = { syncedAt };
    for (const change of fieldChanges) data[change.field] = change.to;
    toUpdate.push({
      id: dbRow.id,
      data,
      debug: fieldChanges.map((c) => `${c.field}: "${c.from ?? ""}"->"${c.to}"`),
    });
    changes.push({
      key: `${record.invoiceNo}${code ? ` / ${record.values.erpItemCode}` : ""}`,
      action: "update",
      fields: fieldChanges,
      rowIds: [dbRow.id],
    });
  }

  // ── Name the inserts, then build their payloads ──
  //
  // `nameByCode` was resolved up front for every code in play. A row that is
  // still unnamed here has no name in any of the four sources.
  const toCreate: Record<string, unknown>[] = [];
  const nameRefreshes: { id: string; data: Record<string, unknown>; debug: string }[] = [];
  const nameRefreshSamples: string[] = [];
  const refreshedIds = new Set<string>();
  let blockedInserts = 0;
  let unnamedInserts = 0;

  // Pass 1 — who is holding the name each blocked insert wants? The row's own
  // code may not be on the sheet, so its current name is resolved in one extra
  // call rather than per row.
  type Blocker = { row: DbRow; code: string };
  const blockers = new Map<number, Blocker | null>();
  const codesToResolve = new Set<string>();

  pendingInserts.forEach((pending, index) => {
    const { record } = pending;
    const code = normalizeKey(record.values.erpItemCode ?? "");
    const itemName = code ? (nameByCode.get(code) ?? "") : "";
    const invoiceKey = normalizeKey(record.invoiceNo);

    if (!takenNameKeys.has(`${invoiceKey}||${normalizeKey(itemName)}`)) {
      blockers.set(index, null);
      return;
    }

    const candidates = byInvoice.get(invoiceKey) ?? [];
    const sameName = candidates.filter(
      (row) => normalizeKey(row.itemName) === normalizeKey(itemName),
    );
    // Prefer the row whose code differs — that is the "two codes, one
    // description" case the fresh name is for.
    const blockerRow =
      sameName.find((row) => normalizeKey(row.erpItemCode ?? "") !== code) ?? sameName[0] ?? null;
    const blocker = blockerRow
      ? { row: blockerRow, code: normalizeKey(blockerRow.erpItemCode ?? "") }
      : null;
    blockers.set(index, blocker);
    if (blocker && blocker.code && !nameByCode.has(blocker.code)) {
      codesToResolve.add(blocker.row.erpItemCode ?? "");
    }
  });

  if (codesToResolve.size > 0) {
    const extra = await resolveItemNames([...codesToResolve].filter(Boolean));
    for (const [code, name] of extra) if (!nameByCode.has(code)) nameByCode.set(code, name);
  }

  // Pass 2 — plan, then queue.
  pendingInserts.forEach((pending, index) => {
    const { record } = pending;
    const code = record.values.erpItemCode ?? "";
    const invoiceKey = normalizeKey(record.invoiceNo);
    const keyFor = (name: string) => `${invoiceKey}||${normalizeKey(name)}`;
    let itemName = code ? (nameByCode.get(normalizeKey(code)) ?? "") : "";

    if (takenNameKeys.has(keyFor(itemName))) {
      // The name we would store is already used on this invoice. Two repairs, in
      // order: refresh the row holding it if that row is itself stale, otherwise
      // fall back to this code's ERP master name — which is what distinguishes
      // two codes whose *stored* names collide (`FVC030011`/`FVC030012` both read
      // `..._200` while the master says `..._150` and `..._200`).
      const plan = planNameRefresh({
        blocker: blockers.get(index) ?? null,
        desiredName: itemName,
        desiredCode: code,
        nameByCode,
        takenNameKeys,
        invoiceKey,
        alreadyRefreshed: refreshedIds,
      });

      if (plan) {
        refreshedIds.add(plan.id);
        nameRefreshes.push({
          id: plan.id,
          data: { itemName: plan.to, syncedAt },
          debug: `itemName: "${plan.from}"->"${plan.to}"`,
        });
        takenNameKeys.delete(`${invoiceKey}||${normalizeKey(plan.from)}`);
        takenNameKeys.add(`${invoiceKey}||${normalizeKey(plan.to)}`);
        if (nameRefreshSamples.length < SAMPLE_SIZE) {
          nameRefreshSamples.push(
            `${plan.blockerCode} "${plan.from}" -> "${plan.to}" (frees "${itemName}")`,
          );
        }
        changes.push({
          key: `${record.invoiceNo} / ${plan.blockerCode}`,
          action: "update",
          fields: [{ field: "itemName", from: plan.from, to: plan.to }],
          rowIds: [plan.id],
          reason: `stored name refreshed to free "${itemName}" for ${code || "this line"}`,
        });
      } else {
        const masterName = code ? (masterNameByCode.get(normalizeKey(code)) ?? "") : "";
        const canUseMaster =
          Boolean(masterName) &&
          normalizeKey(masterName) !== normalizeKey(itemName) &&
          !takenNameKeys.has(keyFor(masterName));

        if (!canUseMaster) {
          blockedInserts++;
          changes.push({
            key: `${record.invoiceNo}${code ? ` / ${code}` : ""}`,
            action: "skipped",
            fields: [],
            reason: `the invoice already has a row named "${itemName}" (the DB key is invoiceNo + itemName)`,
          });
          return;
        }

        if (nameRefreshSamples.length < SAMPLE_SIZE) {
          nameRefreshSamples.push(
            `${code || "line"} stored under its ERP master name "${masterName}" (its supply name "${itemName}" was taken)`,
          );
        }
        itemName = masterName;
      }
    }

    takenNameKeys.add(keyFor(itemName));
    if (!itemName) unnamedInserts++;

    toCreate.push(buildInsert(record, itemName, syncedAt));
    changes.push({
      key: `${record.invoiceNo}${code ? ` / ${code}` : ""}`,
      action: "insert",
      // The resolved name is part of the decision, so it is recorded with it.
      fields: [{ field: "itemName", from: null, to: itemName }, ...pending.changes],
    });
  });

  // ── Write ──
  let inserted = 0;
  let updated = 0;
  let failedWrites = 0;

  if (apply) {
    // Name refreshes first: an insert that needs the freed name would be
    // rejected if it ran before the row holding it was renamed.
    if (nameRefreshes.length > 0) {
      for (const refresh of nameRefreshes) {
        try {
          await prisma.supplyHistoryItem.update({
            where: { id: refresh.id },
            data: refresh.data as never,
          });
          updated++;
        } catch (err) {
          failedWrites++;
          console.error(
            `[execution-tracking] name refresh failed id=${refresh.id} ${refresh.debug} err=${
              err instanceof Error ? err.message : "Unknown error"
            }`,
          );
        }
      }
    }

    if (toCreate.length > 0) {
      const res = await prisma.supplyHistoryItem.createMany({
        data: toCreate as never,
        skipDuplicates: true,
      });
      inserted = res.count;
      if (res.count < toCreate.length) {
        console.log(
          `[execution-tracking] createMany skipped ${
            toCreate.length - res.count
          } duplicate(s) on the DB unique key`,
        );
      }
    }

    const limit = pLimit(WRITE_CONCURRENCY);
    for (let i = 0; i < toUpdate.length; i += WRITE_CHUNK) {
      const chunk = toUpdate.slice(i, i + WRITE_CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((u) =>
          limit(() =>
            prisma.supplyHistoryItem.update({
              where: { id: u.id },
              data: u.data as never,
            }),
          ),
        ),
      );

      settled.forEach((result, idx) => {
        if (result.status === "rejected") {
          failedWrites++;
          console.error(
            `[execution-tracking] update failed id=${chunk[idx].id} fields=${chunk[idx].debug.join(", ")} err=${
              (result.reason as Error)?.message
            }`,
          );
          return;
        }
        updated++;
      });
    }
  } else {
    inserted = toCreate.length;
    updated = toUpdate.length + nameRefreshes.length;
  }

  // Record description-level folds in the log, after the writes, so the row that
  // was folded into is known.
  for (const merge of descriptionMerges) {
    changes.push({
      key: `${merge.invoiceNo} / ${merge.keptCode}`,
      action: "merged",
      fields: merge.quantity === null ? [] : [{ field: "quantity", from: null, to: merge.quantity }],
      reason:
        `folded into ${merge.keptCode}: ${merge.foldedCodes.join(", ")} ` +
        `share the description "${merge.description}" on this invoice`,
    });
  }

  const sampleChanges: string[] = [];
  for (const update of toUpdate.slice(0, SAMPLE_SIZE)) {
    sampleChanges.push(`update id=${update.id} ${update.debug.join("; ")}`);
  }
  for (const create of toCreate.slice(0, Math.max(0, SAMPLE_SIZE - sampleChanges.length))) {
    sampleChanges.push(
      `insert invoiceNo=${String(create.invoiceNo)} itemName="${String(create.itemName).slice(0, 40)}" erpItemCode=${String(create.erpItemCode ?? "")} quantity=${String(create.quantity ?? "")}`,
    );
  }

  const elapsedMs = Date.now() - startedAtMs;

  console.log("\n===== [SCHEDULER] EXECUTION TRACKING SYNC =====");
  console.log(`[scheduler] mode            : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[scheduler] tab             : ${tabTitle} (gid ${gid})`);
  console.log(`[scheduler] fiscal year     : ${financialYear} (input "${financialYearInput}")`);
  console.log(`[scheduler] rows in sheet   : ${rows.length}`);
  console.log(`[scheduler] rows in year    : ${sheetRowsForFy}`);
  console.log(`[scheduler] groups          : ${records.length}${options.limit === undefined ? "" : ` (scanned ${limited.length}, limit ${options.limit})`}`);
  console.log(`[scheduler] merged          : ${mergedGroups} group(s) folded from ${mergedGroups + mergedLineCount} sheet lines`);
  console.log(
    `[scheduler] merged by name  : ${descriptionMerges.length} row(s) folded across item codes${
      descriptionMerges.length
        ? ` (e.g. ${descriptionMerges
            .slice(0, 3)
            .map((m) => `${m.invoiceNo}: ${m.foldedCodes.join("+")} -> ${m.keptCode} qty ${m.quantity}`)
            .join("; ")})`
        : ""
    }`,
  );  console.log(`[scheduler] existing in DB  : ${dbRows.length}`);
  console.log(
    `[scheduler] inserted=${inserted} updated=${updated} unchanged=${unchanged} matched=${matched}`,
  );
  console.log(
    `[scheduler] skippedBlankInvoice=${skippedBlankInvoice} blockedInserts=${blockedInserts} unnamedInserts=${unnamedInserts} ambiguous=${ambiguous} failedWrites=${failedWrites}`,
  );
  console.log(
    `[scheduler] name refreshes  : ${nameRefreshes.length}${
      nameRefreshSamples.length ? ` (e.g. ${nameRefreshSamples.join("; ")})` : ""
    }`,
  );
  console.log(
    `[scheduler] acc map=${accMap.size} misses=${accMissesFrom(records)}`,
  );
  console.log(
    `[scheduler] state skipped   : ${stateSkipped}${
      stateSkippedSamples.length ? ` (e.g. ${stateSkippedSamples.join(", ")})` : ""
    }`,
  );
  if (sampleChanges.length) console.log("[scheduler] samples         :", sampleChanges);
  console.log(`[scheduler] elapsed          : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] EXECUTION TRACKING DONE =====\n");

  const logId =
    options.log === false
      ? null
      : await writeSyncLog({
          kind: SYNC_LOG_KIND.executionTracking,
          financialYear,
          mode: apply ? "apply" : "dry-run",
          status: failedWrites > 0 ? "partial" : "success",
          startedAt,
          scanned: limited.length,
          matched,
          inserted,
          updated,
          unchanged,
          skipped: skippedBlankInvoice + blockedInserts,
          accMisses: records.filter((record) => record.accMiss).length,
          ambiguous,
          failedWrites,
          changes,
        });

  return {
    mode: apply ? "apply" : "dry-run",
    financialYear,
    financialYearInput,
    tabTitle,
    sheetRows: rows.length,
    sheetRowsForFy,
    sheetGroups: records.length,
    scanned: limited.length,
    mergedGroups,
    mergedLines: mergedLineCount,
    mergedDescriptionGroups: descriptionMerges.length,
    descriptionMerges,
    nameRefreshes: nameRefreshes.length,
    nameRefreshSamples,
    matched,
    inserted,
    updated,
    unchanged,
    skippedBlankInvoice,
    blockedInserts,
    unnamedInserts,
    ambiguous,
    accMapSize: accMap.size,
    accMisses: records.filter((record) => record.accMiss).length,
    accMissSamples,
    stateSkipped,
    stateSkippedSamples,
    failedWrites,
    changes,
    sampleChanges,
    logId,
    elapsedMs,
  };
}

/** Consignee codes with no `acc_master` entry, over the whole year. */
function accMissesFrom(records: readonly MappedRecord[]): number {
  let misses = 0;
  for (const record of records) if (record.accMiss) misses++;
  return misses;
}
