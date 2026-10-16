import "dotenv/config";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { sheets as googleSheets } from "@googleapis/sheets";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getOAuthClient } from "../lib/googleAuth";
import { CONTRACTS_SHEET_COLUMNS } from "../lib/gmd_lib/contract-review-columns";

const SPREADSHEET_ID =
  process.env.CONTRACT_REVIEW_SPREADSHEET_ID ??
  process.env.CONTRACT_SHEET_SPREADSHEET_ID ??
  "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE";
const TAB_TITLE = "CONTRACTS";
const HEADER_ROW = 4;
const ROWS_PER_GRID_REQUEST = 5000;

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== SYNC DIAGRAM URL FROM CLEARANCE STATUS (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter(Boolean) as string[];

  const tabTitle = titles.find((t) => t.trim().toUpperCase() === TAB_TITLE);
  if (!tabTitle) {
    throw new Error(
      `Tab "${TAB_TITLE}" not found. Available tabs:\n${titles.join("\n")}`,
    );
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = res.data.values ?? [];
  const headers = (rows[HEADER_ROW - 1] ?? []).map(String);
  const rawData = rows.slice(HEADER_ROW);

  const normalized = headers.map(normalizeHeader);
  const missing = CONTRACTS_SHEET_COLUMNS.filter(
    (c) => !normalized.includes(normalizeHeader(c)),
  );

  console.log(`Spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`Tab: ${tabTitle}`);
  console.log(`Header row: ${HEADER_ROW}, data rows: ${rawData.length}`);
  console.log(
    `Canonical CONTRACTS columns present: ${
      CONTRACTS_SHEET_COLUMNS.length - missing.length
    }/${CONTRACTS_SHEET_COLUMNS.length}`,
  );

  const col = (name: string) => {
    const target = normalizeHeader(name);
    const idx = normalized.findIndex((h) => h === target);
    if (idx < 0) throw new Error(`Column "${name}" not found`);
    return idx;
  };
  const contractIdx = col("CONTRACT NO");
  const itemIdx = col("ITEM_CODE");
  const clearanceIdx = col("CLEARANCE STATUS");
  console.log(
    `CONTRACT NO=${contractIdx + 1}, ITEM_CODE=${itemIdx + 1}, CLEARANCE STATUS=${clearanceIdx + 1}`,
  );

  // Hyperlinks are not returned by values.get. Pull grid data (batched) for the
  // CLEARANCE STATUS column and key links by absolute sheet row.
  const clearanceLetter = colLetter(clearanceIdx);
  const firstRow = HEADER_ROW + 1;
  const endRow = HEADER_ROW + rawData.length;
  const linkByRow = new Map<number, string>();
  for (let from = firstRow; from <= endRow; from += ROWS_PER_GRID_REQUEST) {
    const to = Math.min(from + ROWS_PER_GRID_REQUEST - 1, endRow);
    const grid = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [`'${tabTitle}'!${clearanceLetter}${from}:${clearanceLetter}${to}`],
      includeGridData: true,
      fields:
        "sheets.data.rowData.values.hyperlink,sheets.data.rowData.values.textFormatRuns",
    });
    const gridRows = grid.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    gridRows.forEach((rowData, i) => {
      const cell = rowData.values?.[0];
      if (!cell) return;
      const rich = (cell.textFormatRuns ?? [])
        .map((run) => run.format?.link?.uri)
        .find(Boolean);
      const link = cell.hyperlink ?? rich;
      if (link) linkByRow.set(from + i, link);
    });
    console.log(`  links scanned through row ${to} (found ${linkByRow.size})`);
  }

  // Key = contractNo || itemCode. First non-empty link per key wins.
  const sheetLinks = new Map<string, string>();
  for (let i = 0; i < rawData.length; i++) {
    const link = linkByRow.get(firstRow + i);
    if (!link) continue;
    const contract = normalizeKey(String(rawData[i][contractIdx] ?? ""));
    const item = normalizeKey(String(rawData[i][itemIdx] ?? ""));
    if (!contract || !item) continue;
    const key = `${contract}||${item}`;
    if (!sheetLinks.has(key)) sheetLinks.set(key, link);
  }

  const dbRows = await tenderPrisma.contractReview.findMany({
    select: { id: true, contractNo: true, itemCode: true, diagramUrl: true },
  });
  const byKey = new Map<string, { id: string; diagramUrl: string | null }>();
  for (const r of dbRows) {
    const key = `${normalizeKey(r.contractNo)}||${normalizeKey(r.itemCode)}`;
    if (!byKey.has(key)) byKey.set(key, { id: r.id, diagramUrl: r.diagramUrl });
  }

  const updates: { id: string; contractNo: string; itemCode: string; from: string | null; to: string }[] = [];
  let matched = 0;
  let unchanged = 0;
  let noMatch = 0;

  for (const [key, link] of sheetLinks) {
    const existing = byKey.get(key);
    if (!existing) {
      noMatch++;
      continue;
    }
    matched++;
    if (existing.diagramUrl === link) {
      unchanged++;
      continue;
    }
    const [c, i] = key.split("||");
    updates.push({ id: existing.id, contractNo: c, itemCode: i, from: existing.diagramUrl, to: link });
  }

  console.log(`\nLinked sheet keys:   ${sheetLinks.size}`);
  console.log(`ContractReview rows: ${dbRows.length}`);
  console.log(`Matched:             ${matched}`);
  console.log(`Unchanged:           ${unchanged}`);
  console.log(`To update:           ${updates.length}`);
  console.log(`No DB match:         ${noMatch}`);

  if (updates.length > 0) {
    console.log("\n--- Sample diffs (first 10) ---");
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.contractNo} | ${u.itemCode} | ${u.from ?? "(blank)"} -> ${u.to}`);
    }
  }

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await tenderPrisma.$transaction(
      batch.map((u) =>
        tenderPrisma.contractReview.update({
          where: { id: u.id },
          data: { diagramUrl: u.to },
        }),
      ),
    );
    written += batch.length;
    console.log(`  wrote ${written}/${updates.length}`);
  }

  console.log(`\n=== APPLIED ${written} updates ===\n`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => pool.end());
