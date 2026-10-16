/**
 * ACC_MASTER tab -> `acc_master`.
 *
 * The execution-tracking sync needs "consignee code -> account name" for every
 * row it touches. Rather than ask Google for it on each run, the tab is copied
 * into `acc_master` here and the sync reads the table. Both the hourly job and
 * the manual button refresh it first, so the names can never be stale.
 *
 * Source: `ACC_MASTER_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`
 * (`FORMATTED_VALUE`, header row 1). Columns are resolved by name through
 * `requireColumns`, so a renamed column aborts the run instead of silently
 * reading the wrong one.
 *
 * Write policy:
 *   - one row per code, matched on the normalised code (trim + collapse
 *     whitespace + upper-case), so a casing change in the sheet updates the
 *     existing row instead of creating a second one;
 *   - a blank `ACC_NAME` never clears a stored name;
 *   - a duplicate `ACC_CODE` in the sheet keeps the first row and is counted;
 *   - rows the sheet no longer carries are **kept**, never deleted — the sync
 *     that reads this table can only get *more* conservative, never wrong.
 */

import { prisma } from "@/lib/prisma";
import {
  cell,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";
import {
  ACC_MASTER_HEADERS,
  accMasterGid,
  executionTrackingSpreadsheetId,
  isBlankSheetValue,
  normalizeKey,
} from "@/lib/gmd_lib/execution-tracking-columns";
import { SYNC_LOG_KIND, writeSyncLog, type SyncLogChange } from "@/lib/syncLog";

/** How many duplicate codes are listed in the report before it is just a count. */
const SAMPLE_SIZE = 5;

export type AccMasterSyncOptions = {
  /** Report without writing. */
  dryRun?: boolean;
  /** Write a `sync_log` row. Default true. */
  log?: boolean;
};

export type AccMasterSyncResult = {
  tabTitle: string;
  /** Data rows read from the tab. */
  sheetRows: number;
  /** Rows with a usable code. */
  parsed: number;
  created: number;
  updated: number;
  unchanged: number;
  blankCodeRows: number;
  duplicateCodes: number;
  duplicateCodeSamples: string[];
  failedWrites: number;
  dryRun: boolean;
  logId: string | null;
  elapsedMs: number;
};

/** A parsed sheet row, code already trimmed. */
type ParsedRow = { accCode: string; accName: string | null };

/**
 * Parses the tab. Split out from the writes so the duplicate/blank handling can
 * be exercised without a database.
 */
export function parseAccMasterRows(
  headers: string[],
  rows: string[][],
  tabTitle: string,
): {
  rows: ParsedRow[];
  blankCodeRows: number;
  duplicateCodes: number;
  duplicateCodeSamples: string[];
} {
  const [codeIdx, nameIdx] = requireColumns(
    headers,
    [ACC_MASTER_HEADERS.code, ACC_MASTER_HEADERS.name],
    tabTitle,
  );

  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  const duplicateCodeSamples: string[] = [];
  let blankCodeRows = 0;
  let duplicateCodes = 0;

  for (const row of rows) {
    const accCode = cell(row, codeIdx);
    if (!accCode) {
      blankCodeRows++;
      continue;
    }
    const key = normalizeKey(accCode);
    if (seen.has(key)) {
      duplicateCodes++;
      if (duplicateCodeSamples.length < SAMPLE_SIZE) {
        duplicateCodeSamples.push(accCode);
      }
      continue; // first row wins, deterministically
    }
    seen.add(key);

    const rawName = cell(row, nameIdx);
    out.push({
      accCode,
      accName: isBlankSheetValue(rawName) ? null : rawName,
    });
  }

  return { rows: out, blankCodeRows, duplicateCodes, duplicateCodeSamples };
}

/**
 * Copies the ACC_MASTER tab into `acc_master`.
 *
 * Throws on a fatal error (workbook/tab/gid misconfigured, columns renamed,
 * Google unreachable, DB down). A failed *write* is counted in `failedWrites`
 * and the run continues, so one bad row cannot abandon the rest.
 */
export async function runAccMasterSync(
  options: AccMasterSyncOptions = {},
): Promise<AccMasterSyncResult> {
  const { dryRun = false, log = true } = options;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs);

  const spreadsheetId = executionTrackingSpreadsheetId();
  const gid = accMasterGid();

  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, gid);
  const parsed = parseAccMasterRows(headers, rows, tabTitle);

  // Match on the normalised code, so the row identity survives a casing change.
  const existing = await prisma.accMaster.findMany({
    select: { id: true, accCode: true, accName: true },
  });
  const existingByCode = new Map(
    existing.map((row) => [normalizeKey(row.accCode), row]),
  );

  const toCreate: { accCode: string; accName: string | null; syncedAt: Date }[] = [];
  const toUpdate: {
    id: string;
    accCode: string;
    accName: string | null;
    changes: SyncLogChange["fields"];
  }[] = [];
  const changes: SyncLogChange[] = [];

  for (const row of parsed.rows) {
    const current = existingByCode.get(normalizeKey(row.accCode));

    if (!current) {
      toCreate.push({ ...row, syncedAt: startedAt });
      changes.push({
        key: row.accCode,
        action: "insert",
        fields: row.accName
          ? [{ field: "accName", from: null, to: row.accName }]
          : [],
      });
      continue;
    }

    const fields: SyncLogChange["fields"] = [];
    const currentName = current.accName ?? null;

    // A blank sheet name never clears a stored one.
    const nextName = row.accName ?? currentName;
    if (nextName !== currentName) {
      fields.push({
        field: "accName",
        from: currentName,
        to: nextName ?? "",
      });
    }

    // The code itself can differ in casing/spacing; keep the sheet's spelling.
    const nextCode = row.accCode;
    if (nextCode !== current.accCode) {
      fields.push({ field: "accCode", from: current.accCode, to: nextCode });
    }

    if (fields.length === 0) continue;

    toUpdate.push({
      id: current.id,
      accCode: nextCode,
      accName: nextName,
      changes: fields,
    });
    changes.push({
      key: nextCode,
      action: "update",
      fields,
      rowIds: [current.id],
    });
  }

  let created = 0;
  let updated = 0;
  let failedWrites = 0;

  if (!dryRun) {
    if (toCreate.length > 0) {
      try {
        const res = await prisma.accMaster.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        created = res.count;
        if (res.count < toCreate.length) {
          console.log(
            `[acc-master] createMany skipped ${
              toCreate.length - res.count
            } duplicate(s) on the unique code`,
          );
        }
      } catch (err) {
        failedWrites += toCreate.length;
        console.error(
          `[acc-master] create failed for ${toCreate.length} row(s): ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }

    for (const row of toUpdate) {
      try {
        await prisma.accMaster.update({
          where: { id: row.id },
          data: { accCode: row.accCode, accName: row.accName, syncedAt: startedAt },
        });
        updated++;
      } catch (err) {
        failedWrites++;
        console.error(
          `[acc-master] update failed id=${row.id} code=${row.accCode} err=${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }
  } else {
    created = toCreate.length;
    updated = toUpdate.length;
  }

  const unchanged = parsed.rows.length - toCreate.length - toUpdate.length;
  const elapsedMs = Date.now() - startedAtMs;

  console.log("\n===== [SCHEDULER] ACC MASTER SYNC =====");
  console.log(`[scheduler] mode            : ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`[scheduler] tab             : ${tabTitle} (gid ${gid})`);
  console.log(`[scheduler] rows in sheet   : ${rows.length}`);
  console.log(`[scheduler] parsed          : ${parsed.rows.length}`);
  console.log(
    `[scheduler] created=${created} updated=${updated} unchanged=${unchanged} failedWrites=${failedWrites}`,
  );
  console.log(
    `[scheduler] blankCodeRows=${parsed.blankCodeRows} duplicateCodes=${parsed.duplicateCodes}${
      parsed.duplicateCodeSamples.length
        ? ` (e.g. ${parsed.duplicateCodeSamples.join(", ")})`
        : ""
    }`,
  );
  console.log(`[scheduler] elapsed          : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] ACC MASTER DONE =====\n");

  const logId = log
    ? await writeSyncLog({
        kind: SYNC_LOG_KIND.accMaster,
        financialYear: null,
        mode: dryRun ? "dry-run" : "apply",
        status: failedWrites > 0 ? "partial" : "success",
        startedAt,
        scanned: parsed.rows.length,
        matched: parsed.rows.length,
        inserted: created,
        updated,
        unchanged,
        skipped: parsed.blankCodeRows + parsed.duplicateCodes,
        failedWrites,
        changes,
      })
    : null;

  return {
    tabTitle,
    sheetRows: rows.length,
    parsed: parsed.rows.length,
    created,
    updated,
    unchanged,
    blankCodeRows: parsed.blankCodeRows,
    duplicateCodes: parsed.duplicateCodes,
    duplicateCodeSamples: parsed.duplicateCodeSamples,
    failedWrites,
    dryRun,
    logId,
    elapsedMs,
  };
}
