import * as google from "@googleapis/sheets";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";

const DEFAULT_SPREADSHEET_ID = "1ZxazFFxJPab6Fp34DtJ_ioHxCp5XqnsgKDzwm9lYbcs";
const DEFAULT_TAB_NAME = "Form Responses 1";
const HEADER_SEARCH_ROWS = 10;

export interface EmdCertificateStats {
  totalSheetRows: number;
  headerRowIdx: number;
  parsedSheetRows: number;
  uniqueTendersInSheet: number;
  duplicateTenders: number;
  matchedDbRows: number;
  notFoundTenders: number;
  updatedParty: number;
  updatedUtility: number;
  skippedExistingParty: number;
  skippedExistingUtility: number;
  skippedNullPartyRef: number;
  skippedNullColumn5: number;
  skippedInvalidFrom: number;
  errors: number;
  headerCheck: {
    passed: boolean;
    spreadsheetId: string;
    tabName: string;
    actualHeaders: string[];
    partyRefIdx: number;
    fromIdx: number;
    column5Idx: number;
  };
}

export interface EmdCertificateOptions {
  dryRun?: boolean;
  verbose?: boolean;
  spreadsheetId?: string;
  tabName?: string;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTender(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function getAuth() {
  const email =
    process.env.GDRIVE_CLIENT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GDRIVE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "GDRIVE_CLIENT_EMAIL/GDRIVE_PRIVATE_KEY (or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY) not configured",
    );
  }
  return new google.auth.JWT({
    email: email.trim().replace(/^["']|["']$/g, ""),
    key: key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function syncEmdCertificates(
  options: EmdCertificateOptions = {},
): Promise<EmdCertificateStats> {
  const spreadsheetId = options.spreadsheetId || DEFAULT_SPREADSHEET_ID;
  const tabName = options.tabName || DEFAULT_TAB_NAME;

  const stats: EmdCertificateStats = {
    totalSheetRows: 0,
    headerRowIdx: -1,
    parsedSheetRows: 0,
    uniqueTendersInSheet: 0,
    duplicateTenders: 0,
    matchedDbRows: 0,
    notFoundTenders: 0,
    updatedParty: 0,
    updatedUtility: 0,
    skippedExistingParty: 0,
    skippedExistingUtility: 0,
    skippedNullPartyRef: 0,
    skippedNullColumn5: 0,
    skippedInvalidFrom: 0,
    errors: 0,
    headerCheck: {
      passed: false,
      spreadsheetId,
      tabName,
      actualHeaders: [],
      partyRefIdx: -1,
      fromIdx: -1,
      column5Idx: -1,
    },
  };

  let rows: string[][] = [];
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const range = `'${tabName}'!A:ZZ`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    rows = (res.data.values as string[][]) ?? [];
    stats.totalSheetRows = rows.length;
    if (options.verbose) {
      console.log(`[EmdCertificateSync] Fetched ${rows.length} rows from ${spreadsheetId} / ${tabName}`);
    }
  } catch (err: any) {
    console.error(`[EmdCertificateSync] Failed to fetch sheet ${spreadsheetId} tab "${tabName}": ${err.message}`);
    stats.errors++;
    return stats;
  }

  if (rows.length === 0) {
    console.warn(`[EmdCertificateSync] Sheet "${tabName}" is empty`);
    stats.errors++;
    return stats;
  }

  // Find header row within first HEADER_SEARCH_ROWS
  let headerRowIdx = -1;
  let partyRefIdx = -1;
  let fromIdx = -1;
  let column5Idx = -1;
  let actualHeaders: string[] = [];

  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const row = rows[r] ?? [];
    const normRow = row.map((h) => normalizeHeader(h));
    const pIdx = normRow.findIndex((h) => h === "partyrefno");
    const fIdx = normRow.findIndex((h) => h === "from");
    const cIdx = normRow.findIndex((h) => h === "column5");
    if (pIdx !== -1 && fIdx !== -1 && cIdx !== -1) {
      headerRowIdx = r;
      partyRefIdx = pIdx;
      fromIdx = fIdx;
      column5Idx = cIdx;
      actualHeaders = row.map((h) => String(h ?? "").trim());
      break;
    }
  }

  stats.headerRowIdx = headerRowIdx;
  stats.headerCheck.actualHeaders = actualHeaders;
  stats.headerCheck.partyRefIdx = partyRefIdx;
  stats.headerCheck.fromIdx = fromIdx;
  stats.headerCheck.column5Idx = column5Idx;

  if (headerRowIdx === -1) {
    console.warn(
      `[EmdCertificateSync] Headers not found in first ${HEADER_SEARCH_ROWS} rows. Expected PARTY REF NO / FROM / Column 5. Actual row 0: ${JSON.stringify(rows[0])}`,
    );
    // Fallback: try to search for Column 5 variants with position 4?
    // Already normalized; if still missing, abort.
    stats.errors++;
    return stats;
  }

  stats.headerCheck.passed = true;
  if (options.verbose) {
    console.log(
      `[EmdCertificateSync] Header check passed row ${headerRowIdx}: PARTY REF NO col ${partyRefIdx}, FROM col ${fromIdx}, Column 5 col ${column5Idx}`,
    );
    console.log(`  Headers: ${JSON.stringify(actualHeaders)}`);
  }

  // Build sheet map: normTender -> { original, partyVal?, utilityVal? }
  const sheetMap = new Map<string, { original: string; partyVal?: string; utilityVal?: string }>();

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row || row.length === 0 || row.every((c) => String(c ?? "").trim() === "")) continue;

    const tenderRaw = partyRefIdx < row.length ? row[partyRefIdx] : null;
    const fromRaw = fromIdx < row.length ? row[fromIdx] : null;
    const col5Raw = column5Idx < row.length ? row[column5Idx] : null;

    const tenderStr = toStringOrNull(tenderRaw);
    if (!tenderStr) {
      stats.skippedNullPartyRef++;
      continue;
    }
    const col5Str = toStringOrNull(col5Raw);
    if (!col5Str) {
      stats.skippedNullColumn5++;
      continue;
    }
    const fromStr = toStringOrNull(fromRaw);
    if (!fromStr) {
      stats.skippedInvalidFrom++;
      continue;
    }
    const normFrom = fromStr.trim().toUpperCase();
    if (normFrom !== "PARTY" && normFrom !== "UTILITY") {
      stats.skippedInvalidFrom++;
      if (options.verbose) {
        console.warn(`[EmdCertificateSync] Row ${r + 1}: invalid FROM="${fromStr}" skipped`);
      }
      continue;
    }

    const normTender = normalizeTender(tenderStr);
    if (!normTender) {
      stats.skippedNullPartyRef++;
      continue;
    }

    const existing = sheetMap.get(normTender);
    if (!existing) {
      const entry: { original: string; partyVal?: string; utilityVal?: string } = { original: tenderStr };
      if (normFrom === "PARTY") entry.partyVal = col5Str;
      else entry.utilityVal = col5Str;
      sheetMap.set(normTender, entry);
    } else {
      // Merge — last non-empty wins, count duplicate if different value
      if (normFrom === "PARTY") {
        if (existing.partyVal && existing.partyVal !== col5Str) stats.duplicateTenders++;
        existing.partyVal = col5Str;
      } else {
        if (existing.utilityVal && existing.utilityVal !== col5Str) stats.duplicateTenders++;
        existing.utilityVal = col5Str;
      }
      sheetMap.set(normTender, existing);
    }
    stats.parsedSheetRows++;
  }

  stats.uniqueTendersInSheet = sheetMap.size;
  if (options.verbose) {
    console.log(
      `[EmdCertificateSync] Parsed ${stats.parsedSheetRows} data rows -> ${stats.uniqueTendersInSheet} unique tenders (${stats.duplicateTenders} duplicates overwritten), skippedNullPartyRef=${stats.skippedNullPartyRef} skippedNullColumn5=${stats.skippedNullColumn5} skippedInvalidFrom=${stats.skippedInvalidFrom}`,
    );
  }

  if (sheetMap.size === 0) {
    console.log("[EmdCertificateSync] No valid rows to sync");
    return stats;
  }

  // Fetch DB rows — EmdDetailsCash.tenderNo is not unique, so fetch all and index by normalized tenderNo
  let dbRows: { id: number; tenderNo: string | null; certificateByParty: string | null; certificateByUtility: string | null }[] = [];
  try {
    dbRows = await prisma.emdDetailsCash.findMany({
      select: { id: true, tenderNo: true, certificateByParty: true, certificateByUtility: true },
    });
  } catch (err: any) {
    console.error(`[EmdCertificateSync] DB fetch failed: ${err.message}`);
    stats.errors++;
    return stats;
  }

  // Index DB by normalized tenderNo -> rows[]
  const dbIndex = new Map<string, typeof dbRows>();
  for (const r of dbRows) {
    if (!r.tenderNo || String(r.tenderNo).trim() === "") continue;
    const norm = normalizeTender(String(r.tenderNo));
    if (!norm) continue;
    const arr = dbIndex.get(norm) ?? [];
    arr.push(r);
    dbIndex.set(norm, arr);
  }

  const limit = pLimit(10);
  const tasks: Promise<void>[] = [];

  for (const [normTender, sheetEntry] of sheetMap.entries()) {
    const matchingDbRows = dbIndex.get(normTender);
    if (!matchingDbRows || matchingDbRows.length === 0) {
      stats.notFoundTenders++;
      if (options.verbose) {
        console.log(`[EmdCertificateSync] Not found in DB: tenderNo="${sheetEntry.original}" (norm=${normTender})`);
      }
      continue;
    }

    for (const dbRow of matchingDbRows) {
      stats.matchedDbRows++;

      const data: Record<string, string> = {};
      let needsParty = false;
      let needsUtility = false;

      if (sheetEntry.partyVal !== undefined) {
        const dbEmpty = !dbRow.certificateByParty || String(dbRow.certificateByParty).trim() === "";
        if (dbEmpty) {
          needsParty = true;
          data.certificateByParty = sheetEntry.partyVal;
        } else {
          stats.skippedExistingParty++;
          if (options.verbose) {
            console.log(`[EmdCertificateSync] Skip existing certificateByParty id=${dbRow.id} tenderNo="${dbRow.tenderNo}" already="${dbRow.certificateByParty}"`);
          }
        }
      }

      if (sheetEntry.utilityVal !== undefined) {
        const dbEmpty = !dbRow.certificateByUtility || String(dbRow.certificateByUtility).trim() === "";
        if (dbEmpty) {
          needsUtility = true;
          data.certificateByUtility = sheetEntry.utilityVal;
        } else {
          stats.skippedExistingUtility++;
          if (options.verbose) {
            console.log(`[EmdCertificateSync] Skip existing certificateByUtility id=${dbRow.id} tenderNo="${dbRow.tenderNo}" already="${dbRow.certificateByUtility}"`);
          }
        }
      }

      if (!needsParty && !needsUtility) continue;

      if (options.dryRun) {
        if (needsParty) stats.updatedParty++;
        if (needsUtility) stats.updatedUtility++;
        if (options.verbose) {
          console.log(
            `[DRY-RUN] Would update id=${dbRow.id} tenderNo="${dbRow.tenderNo}" ${needsParty ? `certificateByParty="${data.certificateByParty}"` : ""} ${needsUtility ? `certificateByUtility="${data.certificateByUtility}"` : ""}`,
          );
        }
        continue;
      }

      tasks.push(
        limit(async () => {
          try {
            await prisma.emdDetailsCash.update({ where: { id: dbRow.id }, data });
            if (needsParty) stats.updatedParty++;
            if (needsUtility) stats.updatedUtility++;
            if (options.verbose) {
              console.log(
                `[EmdCertificateSync] Updated id=${dbRow.id} tenderNo="${dbRow.tenderNo}" ${needsParty ? `party="${data.certificateByParty}"` : ""} ${needsUtility ? `utility="${data.certificateByUtility}"` : ""}`,
              );
            }
          } catch (err: any) {
            console.warn(`[EmdCertificateSync] Failed to update id=${dbRow.id} tenderNo="${dbRow.tenderNo}": ${err.message}`);
            stats.errors++;
          }
        }),
      );
    }
  }

  if (tasks.length > 0) await Promise.all(tasks);

  console.log(
    `[EmdCertificateSync] Done: ${stats.updatedParty} party, ${stats.updatedUtility} utility updated (${stats.uniqueTendersInSheet} tenders in sheet, ${stats.matchedDbRows} db rows matched, ${stats.notFoundTenders} not found, ${stats.skippedExistingParty} existing party, ${stats.skippedExistingUtility} existing utility, ${stats.errors} errors)`,
  );

  return stats;
}
