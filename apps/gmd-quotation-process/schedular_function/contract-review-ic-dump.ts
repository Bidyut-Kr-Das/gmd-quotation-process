/**
 * Contract Review step 4 — INSPECTION OFFER DUMP -> offer / inspection / DI.
 *
 * Runs as the last step of `runScheduledContractReview`. It writes only
 * `ContractReview`, so it lives with the other Contract Review steps rather
 * than as a job of its own.
 *
 * An independent port of `scripts/sync-ic-dump.ts`, which is deliberately left
 * untouched as the manual CLI (`npm run ic:sync` / `ic:sync:apply`). The two
 * share the pure merge rules via `lib/gmd_lib/ic-dump-merge.ts`, but the
 * sheet-read + match + write flow is duplicated here on purpose.
 *
 * !! KEEP IN SYNC WITH scripts/sync-ic-dump.ts !!
 * The constants below — IC_DUMP_GID, the five column indices and
 * EXPECTED_HEADERS — are mirrored from that file (constants near its top; the
 * flow runs from its `main()`). The runtime header guard catches a column
 * being reordered or renamed in the SHEET, but it cannot catch someone changing
 * the indices in only one of the two files. If you change the mapping, change
 * both.
 *
 * Source: BOM MAST ERP workbook, tab "INSPECTION OFFER DUMP" (gid 148043829).
 *
 *   A (0)  VRNO          -> offerNumber[]
 *   C (2)  ITEM_CODE     -> itemCode     (join key)
 *   G (6)  CONTRACT_VRNO -> mcNo         (join key)
 *   H (7)  INSPE_VRNO    -> inspectionNumber[]
 *   K (10) DI_DATE       -> diDate[]
 *
 * The join needs `mcNo` + `itemCode`, which step 1 (the CONTRACTS + DUMP sheet
 * sync) is what populates — which is why this runs after it.
 *
 * Write policy: **union, never shrink**, normalised dedupe (case and
 * whitespace insensitive). A blank cell yields no values, so it can never clear
 * a stored value — that falls out of the union rather than needing a guard.
 *
 * Two deliberate differences from the CLI script:
 *   1. No `--apply` gate — the scheduled path always writes. `dryRun` remains
 *      available as an option for a manual check.
 *   2. Each 200-row transaction is individually caught, so one failed batch is
 *      counted in `failedWrites` and the run continues, rather than aborting
 *      with the remaining batches unwritten.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { sheets as googleSheets } from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";
import { getOAuthClient } from "@/lib/googleAuth";
import { BOM_MAST_ERP_SPREADSHEET_ID } from "@/lib/gmd_lib/bomMastErp";
import {
  normalizeKey,
  normalizeHeader,
  splitCell,
  mergeUnion,
  countAdded,
} from "@/lib/gmd_lib/ic-dump-merge";

/** "INSPECTION OFFER DUMP" tab of the BOM MAST ERP workbook. */
const IC_DUMP_GID = 148043829;

const OFFER_IDX = 0; // A  VRNO
const ITEM_CODE_IDX = 2; // C  ITEM_CODE
const MC_NO_IDX = 6; // G  CONTRACT_VRNO
const INSPECTION_IDX = 7; // H  INSPE_VRNO
const DI_DATE_IDX = 10; // K  DI_DATE

/** Fail-fast guard: the expected sheet header at each mapped index. */
const EXPECTED_HEADERS: { idx: number; header: string }[] = [
  { idx: OFFER_IDX, header: "VRNO" },
  { idx: ITEM_CODE_IDX, header: "ITEM_CODE" },
  { idx: MC_NO_IDX, header: "CONTRACT_VRNO" },
  { idx: INSPECTION_IDX, header: "INSPE_VRNO" },
  { idx: DI_DATE_IDX, header: "DI_DATE" },
];

const WRITE_BATCH = 200;
const SAMPLE_SIZE = 5;

type SheetRecord = { offer: string[]; insp: string[]; di: string[] };

export type IcDumpSyncResult = {
  tabTitle: string;
  /** Data rows read from the sheet. */
  sheetRows: number;
  /** Distinct MC No + Item Code keys the sheet produced. */
  distinctKeys: number;
  /** Sheet rows dropped because MC No or Item Code was blank. */
  blankKeyRows: number;
  dbRows: number;
  /** DB rows with no usable key — these can never match. */
  dbRowsWithoutKey: number;
  matched: number;
  rowsToUpdate: number;
  addedOffer: number;
  addedInsp: number;
  addedDi: number;
  /** Sheet keys that matched no DB row. */
  unmatchedSheetKeys: number;
  /** Rows actually written (0 on a dry run). */
  written: number;
  /** Batches that threw. */
  failedWrites: number;
  dryRun: boolean;
  sampleMerges: string[];
  elapsedMs: number;
};

export type IcDumpSyncOptions = {
  /** Compute and report the diff without writing anything. */
  dryRun?: boolean;
};

/**
 * Unions INSPECTION OFFER DUMP values into ContractReview.
 *
 * Throws on a fatal error (tab missing, header guard failure, DB down).
 */
export async function runIcDumpSync(
  options: IcDumpSyncOptions = {},
): Promise<IcDumpSyncResult> {
  const { dryRun = false } = options;
  const startedAt = Date.now();

  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: BOM_MAST_ERP_SPREADSHEET_ID,
  });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === IC_DUMP_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(
      `Tab with gid ${IC_DUMP_GID} not found in the BOM MAST ERP spreadsheet`,
    );
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BOM_MAST_ERP_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = res.data.values ?? [];

  const emptyResult: IcDumpSyncResult = {
    tabTitle,
    sheetRows: 0,
    distinctKeys: 0,
    blankKeyRows: 0,
    dbRows: 0,
    dbRowsWithoutKey: 0,
    matched: 0,
    rowsToUpdate: 0,
    addedOffer: 0,
    addedInsp: 0,
    addedDi: 0,
    unmatchedSheetKeys: 0,
    written: 0,
    failedWrites: 0,
    dryRun,
    sampleMerges: [],
    elapsedMs: Date.now() - startedAt,
  };
  if (allRows.length < 2) return emptyResult;

  // --- Header guard ------------------------------------------------------
  const headers = (allRows[0] ?? []).map(String);
  const mismatches = EXPECTED_HEADERS.filter(
    ({ idx, header }) =>
      normalizeHeader(headers[idx] ?? "") !== normalizeHeader(header),
  );
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(
        ({ idx, header }) =>
          `  index ${idx}: expected "${header}", found "${headers[idx] ?? ""}"`,
      )
      .join("\n");
    throw new Error(
      `Column mapping mismatch in "${tabTitle}" — refusing to run so we do not write the wrong columns:\n${detail}`,
    );
  }

  // --- Sheet rows -> per-key union ---------------------------------------
  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const byKey = new Map<string, SheetRecord>();
  let blankKeyRows = 0;

  for (const row of dataRows) {
    const mcNo = normalizeKey(String(row[MC_NO_IDX] ?? ""));
    const itemCode = normalizeKey(String(row[ITEM_CODE_IDX] ?? ""));
    if (!mcNo || !itemCode) {
      blankKeyRows++;
      continue;
    }
    const key = `${mcNo}||${itemCode}`;

    const prev = byKey.get(key) ?? { offer: [], insp: [], di: [] };
    byKey.set(key, {
      offer: mergeUnion(prev.offer, splitCell(row[OFFER_IDX])),
      insp: mergeUnion(prev.insp, splitCell(row[INSPECTION_IDX])),
      di: mergeUnion(prev.di, splitCell(row[DI_DATE_IDX])),
    });
  }

  // --- Match against the DB ----------------------------------------------
  const crRows = await tenderPrisma.contractReview.findMany({
    select: {
      id: true,
      mcNo: true,
      itemCode: true,
      offerNumber: true,
      inspectionNumber: true,
      diDate: true,
    },
  });

  let matched = 0;
  let addedOffer = 0;
  let addedInsp = 0;
  let addedDi = 0;
  const sampleMerges: string[] = [];
  const seenDbKeys = new Set<string>();
  let dbRowsWithoutKey = 0;

  const updates: {
    id: string;
    offerNumber: string[];
    inspectionNumber: string[];
    diDate: string[];
  }[] = [];

  for (const row of crRows) {
    const normMc = normalizeKey(row.mcNo);
    const normItem = normalizeKey(row.itemCode);
    // A row needs BOTH halves to be usable. Counting either-half-blank matches
    // the CLI script's reported figure; rows like "||ITEM" can never appear in
    // byKey (which always has both halves), so skipping them here cannot change
    // unmatchedSheetKeys.
    if (!normMc || !normItem) {
      dbRowsWithoutKey++;
      continue;
    }
    const key = `${normMc}||${normItem}`;
    seenDbKeys.add(key);

    const ic = byKey.get(key);
    if (!ic) continue;
    matched++;

    const existingOffer = row.offerNumber ?? [];
    const existingInsp = row.inspectionNumber ?? [];
    const existingDi = row.diDate ?? [];

    const mergedOffer = mergeUnion(existingOffer, ic.offer);
    const mergedInsp = mergeUnion(existingInsp, ic.insp);
    const mergedDi = mergeUnion(existingDi, ic.di);

    const dOffer = countAdded(existingOffer, mergedOffer);
    const dInsp = countAdded(existingInsp, mergedInsp);
    const dDi = countAdded(existingDi, mergedDi);

    // Union never shrinks, so "differs" is exactly "appended something".
    if (dOffer === 0 && dInsp === 0 && dDi === 0) continue;

    addedOffer += dOffer;
    addedInsp += dInsp;
    addedDi += dDi;
    updates.push({
      id: row.id,
      offerNumber: mergedOffer,
      inspectionNumber: mergedInsp,
      diDate: mergedDi,
    });

    if (sampleMerges.length < SAMPLE_SIZE) {
      sampleMerges.push(
        `mc=${row.mcNo} item=${row.itemCode} | offer +${dOffer} -> [${mergedOffer.join(",")}] | insp +${dInsp} -> [${mergedInsp.join(",")}] | di +${dDi} -> [${mergedDi.join(",")}]`,
      );
    }
  }

  const unmatchedSheetKeys = [...byKey.keys()].filter(
    (k) => !seenDbKeys.has(k),
  ).length;

  // --- Write, in independently-guarded batches ---------------------------
  let written = 0;
  let failedWrites = 0;

  if (!dryRun && updates.length > 0) {
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const batch = updates.slice(i, i + WRITE_BATCH);
      try {
        await tenderPrisma.$transaction(
          batch.map((u) =>
            tenderPrisma.contractReview.update({
              where: { id: u.id },
              data: {
                offerNumber: u.offerNumber,
                inspectionNumber: u.inspectionNumber,
                diDate: u.diDate,
              },
            }),
          ),
        );
        written += batch.length;
      } catch (err) {
        failedWrites += batch.length;
        console.error(
          `[ic-dump] batch failed (${batch.length} rows, offset ${i}) err=${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] IC DUMP (INSPECTION OFFER DUMP) =====");
  console.log(`[scheduler] mode              : ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`[scheduler] tab               : ${tabTitle}`);
  console.log(
    `[scheduler] sheet rows        : ${dataRows.length} (blank-key skipped ${blankKeyRows})`,
  );
  console.log(`[scheduler] distinct keys     : ${byKey.size}`);
  console.log(
    `[scheduler] DB rows           : ${crRows.length} (without usable key ${dbRowsWithoutKey})`,
  );
  console.log(`[scheduler] matched           : ${matched}`);
  console.log(`[scheduler] rows to update    : ${updates.length}`);
  console.log(
    `[scheduler] values to add     : offer +${addedOffer}, insp +${addedInsp}, di +${addedDi}`,
  );
  console.log(`[scheduler] unmatched sheet keys : ${unmatchedSheetKeys}`);
  console.log(
    `[scheduler] written=${written} failedWrites=${failedWrites}`,
  );
  if (sampleMerges.length) {
    console.log("[scheduler] sample merges     :");
    for (const s of sampleMerges) console.log(`  ${s}`);
  }
  console.log(`[scheduler] elapsed            : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] IC DUMP DONE =====\n");

  return {
    tabTitle,
    sheetRows: dataRows.length,
    distinctKeys: byKey.size,
    blankKeyRows,
    dbRows: crRows.length,
    dbRowsWithoutKey,
    matched,
    rowsToUpdate: updates.length,
    addedOffer,
    addedInsp,
    addedDi,
    unmatchedSheetKeys,
    written,
    failedWrites,
    dryRun,
    sampleMerges,
    elapsedMs,
  };
}