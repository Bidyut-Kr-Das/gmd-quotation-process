/**
 * INSPECTION OFFER DUMP -> ContractReview array columns.
 *
 * Source: tab "INSPECTION OFFER DUMP" (gid 148043829) of the BOM MAST ERP
 * workbook. Replaces the previous source, the "IC DUMP" tab (gid 402078548) of
 * CONTRACT_REVIEW_SPREADSHEET_ID, which is no longer read.
 *
 * The new tab has no contract number, so the join key is now
 * **MC No + Item Code** (previously Item Code + Contract No).
 *
 * Column mapping is POSITIONAL, because the sheet's own header names do not
 * match our field names — column A is literally "VRNO" but lands in
 * `offerNumber`. Indices are asserted against the expected header names at
 * startup, so a column inserted in the sheet aborts the run instead of silently
 * shifting the mapping.
 *
 *   A (0)  VRNO          -> offerNumber[]
 *   C (2)  ITEM_CODE     -> itemCode     (join key)
 *   G (6)  CONTRACT_VRNO -> mcNo         (join key)
 *   H (7)  INSPE_VRNO    -> inspectionNumber[]
 *   K (10) DI_DATE       -> diDate[]
 *
 * Write policy: **union, never shrink**. Each value is appended if an
 * equivalent one is not already present, compared after normalisation (trim,
 * collapse whitespace, upper-case) so `id22y-18` and `ID22Y-18` are the same
 * value. Existing DB values are never removed, and the DB's own order and
 * casing are preserved. A blank sheet cell yields no values, so it can never
 * clear a stored value — that falls out of the union rather than needing a
 * separate guard.
 *
 * This matters beyond tidiness: `offerPendingDone` is DONE iff
 * `itemCode + mcNo + offerNumber` are set, and `inspection` is DONE iff
 * `offerNumber + inspectionNumber` are set (app/contract_review/page.tsx:1223,1258).
 * A blank cell clearing one of these arrays would silently flip a row from
 * DONE back to PENDING.
 *
 * Usage:
 *   npm run ic:sync          # dry run
 *   npm run ic:sync:apply    # write
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";
import { BOM_MAST_ERP_SPREADSHEET_ID } from "../lib/gmd_lib/bomMastErp";
import {
  normalizeKey,
  normalizeHeader,
  splitCell,
  mergeUnion,
  countAdded,
} from "../lib/gmd_lib/ic-dump-merge";

/** "INSPECTION OFFER DUMP" tab of the BOM MAST ERP workbook. */
const IC_DUMP_GID = 148043829;

const OFFER_IDX = 0; // A  VRNO
const ITEM_CODE_IDX = 2; // C  ITEM_CODE
const MC_NO_IDX = 6; // G  CONTRACT_VRNO
const INSPECTION_IDX = 7; // H  INSPE_VRNO
const DI_DATE_IDX = 10; // K  DI_DATE

/** Fail-fast header guard: the expected sheet header at each mapped index. */
const EXPECTED_HEADERS: { idx: number; header: string }[] = [
  { idx: OFFER_IDX, header: "VRNO" },
  { idx: ITEM_CODE_IDX, header: "ITEM_CODE" },
  { idx: MC_NO_IDX, header: "CONTRACT_VRNO" },
  { idx: INSPECTION_IDX, header: "INSPE_VRNO" },
  { idx: DI_DATE_IDX, header: "DI_DATE" },
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SheetRecord = { offer: string[]; insp: string[]; di: string[] };

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== SYNC INSPECTION OFFER DUMP -> ContractReview offerNumber/inspectionNumber/diDate (${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
  );
  console.log(`source: BOM MAST ERP / gid ${IC_DUMP_GID}`);
  console.log(`join key: MC No + Item Code\n`);

  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

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
  if (allRows.length < 2) {
    console.log(`No data rows found in "${tabTitle}".`);
    return;
  }

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
  console.log("Header guard OK:");
  for (const { idx, header } of EXPECTED_HEADERS) {
    console.log(`  index ${String(idx).padStart(2)} = "${headers[idx]}" (expected ${header})`);
  }

  // --- Build sheet-side records, unioned per key -------------------------
  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const byKey = new Map<string, SheetRecord>();
  let skippedBlankKey = 0;

  for (const row of dataRows) {
    const mcNo = normalizeKey(String(row[MC_NO_IDX] ?? ""));
    const itemCode = normalizeKey(String(row[ITEM_CODE_IDX] ?? ""));
    if (!mcNo || !itemCode) {
      skippedBlankKey++;
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

  console.log(
    `\nsheet rows: ${dataRows.length}, distinct keys: ${byKey.size}, blank key rows skipped: ${skippedBlankKey}`,
  );

  // --- Match against the DB ----------------------------------------------
  const crRows = await prisma.contractReview.findMany({
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
  let toUpdate = 0;
  let addedOffer = 0;
  let addedInsp = 0;
  let addedDi = 0;
  const samples: string[] = [];
  const seenDbKeys = new Set<string>();

  const updates: {
    id: string;
    offerNumber: string[];
    inspectionNumber: string[];
    diDate: string[];
  }[] = [];

  for (const row of crRows) {
    const key = `${normalizeKey(row.mcNo)}||${normalizeKey(row.itemCode)}`;
    if (key === "||") continue;
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

    toUpdate++;
    addedOffer += dOffer;
    addedInsp += dInsp;
    addedDi += dDi;
    updates.push({
      id: row.id,
      offerNumber: mergedOffer,
      inspectionNumber: mergedInsp,
      diDate: mergedDi,
    });

    if (samples.length < 5) {
      samples.push(
        `mc=${row.mcNo} item=${row.itemCode} | offer +${dOffer} -> [${mergedOffer.join(",")}] | insp +${dInsp} -> [${mergedInsp.join(",")}] | di +${dDi} -> [${mergedDi.join(",")}]`,
      );
    }
  }

  const unmatchedSheetKeys = [...byKey.keys()].filter((k) => !seenDbKeys.has(k));
  const dbRowsWithoutMc = crRows.filter(
    (r) => !normalizeKey(r.mcNo) || !normalizeKey(r.itemCode),
  ).length;

  console.log(`ContractReview rows        : ${crRows.length}`);
  console.log(`  without usable key       : ${dbRowsWithoutMc}`);
  console.log(`Matched by MC No + Item    : ${matched}`);
  console.log(`Rows to update             : ${toUpdate}`);
  console.log(`  values to add            : offer +${addedOffer}, insp +${addedInsp}, di +${addedDi}`);
  console.log(`Sheet keys with no DB row  : ${unmatchedSheetKeys.length}`);

  if (samples.length > 0) {
    console.log("\n--- Sample merges ---");
    for (const s of samples) console.log(`  ${s}`);
  }

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.contractReview.update({
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
  }

  console.log(`\nApplied ${written} row update(s).\n`);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());