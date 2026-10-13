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
 * Match key: **invoice number** (`VRNO`). One invoice can legitimately own
 * several `SupplyHistoryItem` rows (measured: 65 of the FY 2026-27 invoices do),
 * each a different line with its own quantity, so a second step narrows a
 * multi-row invoice by `ITEM_CODE` before writing anything. When that cannot
 * split the rows — the codes are blank, or two lines share one — the record is
 * counted as `ambiguous` and **skipped**, because writing one line's quantity
 * onto its siblings would corrupt them silently. The count is in the report and
 * the log, so the volume is visible instead of hidden in a guess.
 *
 * The mirror image is guarded too: when the sheet splits an invoice into several
 * lines but the DB holds only *one* row for it, every line would match that one
 * row and overwrite its sibling's values in turn. Only the line whose `ITEM_CODE`
 * equals the row's may write; the rest are `ambiguous`. See
 * `skipSoleCandidate`.
 *
 * Write policy:
 *   - `quantity`, `uom`, `lrNoDt`, `consigneeAddress`, `erpItemCode` and
 *     `consigneeName` are overwritten when the sheet value is non-blank and
 *     differs. Blank cells — including `-` `--` `—` `–` — never clear a value.
 *   - `state` is written **only** when the sheet value is a recognised Indian
 *     state, and written in the DB's Title Case. Comparison is on the canonical
 *     form, so a row that already means the same thing (`Chattisgarh` vs
 *     `CHATTISGARH`) is never rewritten. An unrecognised value leaves the field
 *     alone and is counted in `stateSkipped`.
 *   - a row that does not exist yet is inserted with `itemName` left blank (the
 *     sheet carries no item name) and the target fiscal year, so an operator can
 *     fill the name in on `/supply_history`. Only the first sheet row for an
 *     invoice can insert — the rest are counted as duplicates, because the DB
 *     unique key is `(invoiceNo, itemName)` and a second blank-name row for the
 *     same invoice cannot exist.
 *   - `invoiceNo`, `itemName`, `financialYear` are never overwritten on an
 *     existing row. Nothing is ever deleted.
 *   - `syncedAt` is stamped only on rows actually written.
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
  /** Only consider the first N sheet rows for the year. For a smoke test. */
  limit?: number;
  /** Write a `sync_log` row. Default true, including for a dry run. */
  log?: boolean;
};

/** A sheet row, parsed and ready to diff. */
export type MappedRecord = {
  invoiceNo: string;
  /** Canonical `YYYY-YY` target. */
  financialYear: string;
  /** Raw `CONSIGNEE_CODE`, kept for the join and the log. */
  consigneeCode: string;
  /** `ACC_NAME` for the code, or `null` when the code is blank/unmatched. */
  consigneeName: string | null;
  /** The code was present but is not in `acc_master`. */
  accMiss: boolean;
  /** Non-blank sheet values only. */
  values: Partial<Record<SaleBillField, string>>;
  /** Raw state cell, for the unrecognised-state report. */
  stateRaw: string | null;
  /** Canonical Title Case state, or `null` when unrecognised. */
  stateCanonical: string | null;
};

/** The columns preloaded from `SupplyHistoryItem`. */
export type DbRow = {
  id: string;
  invoiceNo: string | null;
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
  /** Rows actually considered, after `limit`. */
  scanned: number;
  /** Records resolved to exactly one DB row. */
  matched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Rows skipped for a blank invoice number. */
  skippedBlankInvoice: number;
  /** Repeats: same invoice + item code twice on the sheet, or a second insert for one invoice. */
  duplicateInSheet: number;
  /** One invoice, several DB rows, ITEM_CODE cannot split them — never written. */
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

/**
 * Picks the DB row a sheet record belongs to.
 *
 * `invoiceNo` alone is ambiguous whenever an invoice has several lines, so a
 * multi-candidate invoice is narrowed by `ITEM_CODE` first. Anything still
 * unresolved is reported rather than guessed at.
 */
export function pickDbRow(
  candidates: DbRow[],
  record: MappedRecord,
): { row: DbRow | null; ambiguous: boolean } {
  if (candidates.length === 0) return { row: null, ambiguous: false };
  if (candidates.length === 1) return { row: candidates[0], ambiguous: false };

  const code = normalizeKey(record.values.erpItemCode ?? "");
  if (code) {
    const narrowed = candidates.filter(
      (candidate) => normalizeKey(candidate.erpItemCode ?? "") === code,
    );
    if (narrowed.length === 1) return { row: narrowed[0], ambiguous: false };
  }
  return { row: null, ambiguous: true };
}

/**
 * True when a single DB row is the only candidate for an invoice the sheet has
 * split into several lines, and this record's `ITEM_CODE` is not the one on that
 * row.
 *
 * There is only one DB row to narrow, so every line would match it and they
 * would overwrite each other in turn — the last one silently winning. Only the
 * line whose code matches may write; the others are reported as ambiguous.
 */
export function skipSoleCandidate(
  record: MappedRecord,
  candidates: DbRow[],
  sheetLineCount: number,
): boolean {
  if (candidates.length !== 1 || sheetLineCount <= 1) return false;
  const sheetCode = normalizeKey(record.values.erpItemCode ?? "");
  const dbCode = normalizeKey(candidates[0].erpItemCode ?? "");
  return !sheetCode || !dbCode || sheetCode !== dbCode;
}

/**
 * The field-level diff for one record.
 *
 * `row === null` means "insert", so every non-blank sheet value is a change
 * from nothing. An empty result on an existing row means "unchanged".
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

/** The `create` payload for a record that has no DB row yet. */
function buildInsert(record: MappedRecord, syncedAt: Date): Record<string, unknown> {
  const data: Record<string, unknown> = {
    invoiceNo: record.invoiceNo,
    // The sheet carries no item name; a blank placeholder is deliberate so the
    // row shows up on /supply_history and an operator can name it.
    itemName: "",
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
  const [invoiceNoIdx, consigneeCodeIdx, ...fieldIdx] = requireColumns(
    headers,
    [
      SALE_BILL_KEY_HEADERS.invoiceNo,
      SALE_BILL_KEY_HEADERS.consigneeCode,
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

  const records: MappedRecord[] = [];
  const seen = new Set<string>();
  const seenInvoiceForInsert = new Set<string>();
  const accMissSamples: string[] = [];

  let sheetRowsForFy = 0;
  let skippedBlankInvoice = 0;
  let duplicateInSheet = 0;
  let accMisses = 0;

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

    // One invoice + one item code identifies a line; the same pair twice on the
    // sheet is a duplicate, not an update.
    const identity = `${normalizeKey(invoiceNo)}||${normalizeKey(values.erpItemCode ?? "")}`;
    if (seen.has(identity)) {
      duplicateInSheet++;
      continue;
    }
    seen.add(identity);

    const consigneeCode = cell(row, consigneeCodeIdx);
    const accName = consigneeCode ? accMap.get(normalizeKey(consigneeCode)) : undefined;
    const accMiss = Boolean(consigneeCode) && !accName;
    if (accMiss) {
      accMisses++;
      if (accMissSamples.length < SAMPLE_SIZE) accMissSamples.push(consigneeCode);
    }

    const stateRaw = values.state ?? null;
    const stateCanonical = stateRaw ? canonicalizeState(stateRaw) : null;

    records.push({
      invoiceNo,
      financialYear,
      consigneeCode,
      consigneeName: accName ?? null,
      accMiss,
      values,
      stateRaw,
      stateCanonical,
    });
  }

  const limited =
    typeof options.limit === "number" && options.limit >= 0
      ? records.slice(0, options.limit)
      : records;

  const dbRows = await prisma.supplyHistoryItem.findMany({
    where: { financialYear: { in: fiscalYearVariants(financialYear) } },
    select: {
      id: true,
      invoiceNo: true,
      financialYear: true,
      quantity: true,
      uom: true,
      lrNoDt: true,
      state: true,
      consigneeAddress: true,
      erpItemCode: true,
      consigneeName: true,
    },
  });

  const byInvoice = new Map<string, DbRow[]>();
  for (const dbRow of dbRows) {
    const key = normalizeKey(dbRow.invoiceNo ?? "");
    if (!key) continue;
    const list = byInvoice.get(key);
    if (list) list.push(dbRow);
    else byInvoice.set(key, [dbRow]);
  }

  const syncedAt = new Date();
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; data: Record<string, unknown>; debug: string[] }[] = [];
  const changes: SyncLogChange[] = [];
  const sampleChanges: string[] = [];
  const stateSkippedSamples: string[] = [];

  let matched = 0;
  let unchanged = 0;
  let ambiguous = 0;
  let stateSkipped = 0;

  // How many sheet lines each invoice has. Needed because a DB row can be the
  // sole candidate for an invoice that the sheet splits into several lines: the
  // item code cannot separate them (there is only one DB row to narrow), so
  // without this check the lines would overwrite each other in turn and the last
  // one would win. Only the line whose code matches the DB row may write.
  const sheetLinesPerInvoice = new Map<string, number>();
  for (const record of limited) {
    const key = normalizeKey(record.invoiceNo);
    sheetLinesPerInvoice.set(key, (sheetLinesPerInvoice.get(key) ?? 0) + 1);
  }

  for (const record of limited) {
    const invoiceKey = normalizeKey(record.invoiceNo);
    const candidates = byInvoice.get(invoiceKey) ?? [];
    const { row: dbRow, ambiguous: isAmbiguous } = pickDbRow(candidates, record);

    if (isAmbiguous) {
      ambiguous++;
      continue;
    }

    if (skipSoleCandidate(record, candidates, sheetLinesPerInvoice.get(invoiceKey) ?? 0)) {
      ambiguous++;
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
      // A second insert for one invoice would break `@@unique([invoiceNo, itemName])`.
      if (seenInvoiceForInsert.has(normalizeKey(record.invoiceNo))) {
        duplicateInSheet++;
        continue;
      }
      seenInvoiceForInsert.add(normalizeKey(record.invoiceNo));
      toCreate.push(buildInsert(record, syncedAt));
      changes.push({
        key: `${record.invoiceNo}${record.values.erpItemCode ? ` / ${record.values.erpItemCode}` : ""}`,
        action: "insert",
        fields: fieldChanges,
      });
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
      key: `${record.invoiceNo}${record.values.erpItemCode ? ` / ${record.values.erpItemCode}` : ""}`,
      action: "update",
      fields: fieldChanges,
      rowIds: [dbRow.id],
    });
  }

  let inserted = 0;
  let updated = 0;
  let failedWrites = 0;

  if (apply) {
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
    updated = toUpdate.length;
  }

  for (const update of toUpdate.slice(0, SAMPLE_SIZE)) {
    sampleChanges.push(`update id=${update.id} ${update.debug.join("; ")}`);
  }
  for (const create of toCreate.slice(0, Math.max(0, SAMPLE_SIZE - sampleChanges.length))) {
    sampleChanges.push(
      `insert invoiceNo=${String(create.invoiceNo)} erpItemCode=${String(create.erpItemCode ?? "")} quantity=${String(create.quantity ?? "")}`,
    );
  }

  const elapsedMs = Date.now() - startedAtMs;

  console.log("\n===== [SCHEDULER] EXECUTION TRACKING SYNC =====");
  console.log(`[scheduler] mode            : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[scheduler] tab             : ${tabTitle} (gid ${gid})`);
  console.log(`[scheduler] fiscal year     : ${financialYear} (input "${financialYearInput}")`);
  console.log(`[scheduler] rows in sheet   : ${rows.length}`);
  console.log(`[scheduler] rows in year    : ${sheetRowsForFy}`);
  console.log(`[scheduler] scanned         : ${limited.length}${options.limit === undefined ? "" : ` (limit ${options.limit})`}`);
  console.log(`[scheduler] existing in DB  : ${dbRows.length}`);
  console.log(
    `[scheduler] inserted=${inserted} updated=${updated} unchanged=${unchanged} matched=${matched}`,
  );
  console.log(
    `[scheduler] skippedBlankInvoice=${skippedBlankInvoice} duplicateInSheet=${duplicateInSheet} ambiguous=${ambiguous} failedWrites=${failedWrites}`,
  );
  console.log(
    `[scheduler] acc map=${accMap.size} misses=${accMisses}${
      accMissSamples.length ? ` (e.g. ${accMissSamples.join(", ")})` : ""
    }`,
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
          skipped: skippedBlankInvoice + duplicateInSheet,
          accMisses,
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
    scanned: limited.length,
    matched,
    inserted,
    updated,
    unchanged,
    skippedBlankInvoice,
    duplicateInSheet,
    ambiguous,
    accMapSize: accMap.size,
    accMisses,
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
