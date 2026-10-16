/**
 * Script to sync erpPartyName from Smartsheet sheet 5621905471000452
 * Matches TenderMerged.docketNo against "Docket No (Debosmita Nath)"
 * and updates TenderMerged.erpPartyName with "Party Name (Debosmita Nath)".
 *
 * Rules (strict):
 *  - Sheet partyName null/empty -> skip (never writes "" to DB)
 *  - DB docketNo null/empty -> skip
 *  - Only updates existing TenderMerged records, never creates new ones
 *  - By default does not overwrite existing erpPartyName; use --force to overwrite
 *  - Column names verified before any DB write (aborts if missing)
 *
 * Usage:
 *   npx tsx scripts/syncErpPartyNameFromSmartsheet.ts
 *   npx tsx scripts/syncErpPartyNameFromSmartsheet.ts --dry-run
 *   npx tsx scripts/syncErpPartyNameFromSmartsheet.ts --dry-run --verbose
 *   npx tsx scripts/syncErpPartyNameFromSmartsheet.ts --force --verbose
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fetchSmartsheetById, type SmartsheetCell } from "../lib/smartsheet";

const SHEET_ID = "5621905471000452";
const DOCKET_COL = "Docket No (Debosmita Nath)";
const PARTY_COL = "Party Name (Debosmita Nath)";

function parseArgs(): { dryRun: boolean; verbose: boolean; force: boolean; help: boolean } {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run") || args.includes("--dryRun"),
    verbose: args.includes("--verbose"),
    force: args.includes("--force"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

function getCellValue(cells: SmartsheetCell[], columnId: number | undefined): string | null {
  if (columnId === undefined) return null;
  const cell = cells.find((c) => c.columnId === columnId);
  if (!cell) return null;
  if (cell.displayValue !== undefined && cell.displayValue !== null) {
    return String(cell.displayValue).trim() || null;
  }
  if (cell.value !== undefined && cell.value !== null) {
    return String(cell.value).trim() || null;
  }
  return null;
}

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveColumnId(
  columnIndex: Map<string, number>,
  allColumns: { id: number; title: string }[],
  targetTitle: string,
): number | undefined {
  const exact = columnIndex.get(targetTitle);
  if (exact !== undefined) return exact;
  const trimmed = columnIndex.get(targetTitle.trim());
  if (trimmed !== undefined) return trimmed;
  const normTarget = normalizeTitle(targetTitle);
  for (const col of allColumns) {
    if (normalizeTitle(col.title) === normTarget) return col.id;
  }
  return undefined;
}

async function main() {
  const { dryRun, verbose, force, help } = parseArgs();
  if (help) {
    console.log(`
Usage: npx tsx scripts/syncErpPartyNameFromSmartsheet.ts [options]

Options:
  --dry-run   Simulate without DB writes
  --verbose   Log column check, lookup build, per-row updates
  --force     Overwrite existing erpPartyName (default: skip if already present)
  --help, -h  Show this help

Rules:
  - Sheet partyName null/empty -> skip (never writes empty)
  - DB docketNo null/empty -> skip
  - Only updates existing TenderMerged, never creates
  - By default skips if erpPartyName already present

Sheet: ${SHEET_ID}
  Docket column: "${DOCKET_COL}"
  Party column:  "${PARTY_COL}" -> erpPartyName
`);
    process.exit(0);
  }

  console.log("=".repeat(70));
  console.log("  ErpPartyName Sync — Smartsheet 5621905471000452 (Docket → Party Name)");
  console.log("=".repeat(70));
  if (dryRun) console.log("  MODE: DRY-RUN (no DB writes)\n");
  if (verbose) console.log("  MODE: VERBOSE\n");
  if (force) console.log("  MODE: FORCE (overwrite existing erpPartyName)\n");

  const totalBefore = await prisma.tenderMerged.count({
    where: { erpPartyName: { not: null } },
  });
  const totalNullBefore = await prisma.tenderMerged.count({
    where: { OR: [{ erpPartyName: null }, { erpPartyName: "" }] },
  });
  console.log(`  Records with erpPartyName before: ${totalBefore}`);
  console.log(`  Records with null/empty erpPartyName before: ${totalNullBefore}`);

  // 1. Fetch Smartsheet by ID
  let sheetData;
  try {
    sheetData = await fetchSmartsheetById(SHEET_ID);
  } catch (err) {
    console.error("[ErpPartyNameSync] Failed to fetch Smartsheet:", (err as Error).message);
    await prisma.$disconnect();
    process.exit(1);
  }

  const columns = sheetData.columns || [];
  const rows = sheetData.rows || [];
  console.log(`\n  Sheet "${sheetData.name}" (id=${sheetData.id}) — ${columns.length} cols, ${rows.length} rows`);

  // 2. Build column index and verify
  const columnIndex = new Map<string, number>();
  for (const col of columns) {
    if (col.title) {
      columnIndex.set(col.title.trim(), col.id);
      if (col.title !== col.title.trim()) columnIndex.set(col.title, col.id);
    }
  }

  const docketColId = resolveColumnId(columnIndex, columns, DOCKET_COL);
  const partyColId = resolveColumnId(columnIndex, columns, PARTY_COL);

  console.log("\n" + "=".repeat(70));
  console.log("  Column Check");
  console.log("=".repeat(70));
  console.log(`  Docket "${DOCKET_COL}" : ${docketColId ? `FOUND (id ${docketColId})` : "NOT FOUND — aborted"}`);
  console.log(`  Party  "${PARTY_COL}" : ${partyColId ? `FOUND (id ${partyColId})` : "NOT FOUND — aborted"}`);
  if (!docketColId || !partyColId) {
    console.log(`\n  Available columns (${columns.length}):`);
    for (const c of columns) console.log(`    - "${c.title}"`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (verbose) {
    console.log(`\n  All columns:`);
    for (const c of columns) console.log(`    [${c.id}] "${c.title}"`);
  }

  // 3. Build lookup docketLower -> partyName (skip empty partyName)
  const partyLookup = new Map<string, string>();
  let skippedNullDocketSheet = 0;
  let skippedNullPartySheet = 0;
  let duplicateDockets = 0;

  for (const row of rows) {
    const cells = row.cells || [];
    const docketNo = getCellValue(cells, docketColId);
    if (!docketNo || docketNo.trim() === "" || docketNo.trim() === "-") {
      skippedNullDocketSheet++;
      continue;
    }
    const partyName = getCellValue(cells, partyColId);
    // Rule: do not insert if party name is ""/null/empty
    if (!partyName || partyName.trim() === "") {
      skippedNullPartySheet++;
      continue;
    }
    const pTrim = partyName.trim();
    if (pTrim === "-" || pTrim.toLowerCase() === "n.a" || pTrim.toLowerCase() === "na") {
      skippedNullPartySheet++;
      continue;
    }
    const key = docketNo.trim().toLowerCase();
    if (partyLookup.has(key)) {
      duplicateDockets++;
      if (verbose) console.warn(`  Duplicate docket "${docketNo}" keep first "${partyLookup.get(key)}" ignore "${pTrim}" row ${row.rowNumber}`);
      continue;
    }
    partyLookup.set(key, pTrim);
  }

  if (verbose) {
    console.log(`\n  Lookup built: ${partyLookup.size} docket->party mappings (${skippedNullPartySheet} skipped null/empty party, ${skippedNullDocketSheet} skipped null docket, ${duplicateDockets} duplicates)`);
  } else {
    console.log(`\n  Lookup: ${partyLookup.size} mappings, ${skippedNullPartySheet} skipped empty party, ${duplicateDockets} duplicates`);
  }

  // 4. Scan TenderMerged — only update existing, never create
  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, docketNo: true, erpPartyName: true },
  });

  let total = allTenders.length;
  let found = 0;
  let updated = 0;
  let notFound = 0;
  let skippedExisting = 0;
  let skippedNullDocketDb = 0;
  let errors = 0;

  for (const tender of allTenders) {
    if (!tender.docketNo || tender.docketNo.trim() === "" || tender.docketNo.trim() === "-") {
      skippedNullDocketDb++;
      continue;
    }
    // Only update existing: skip if already has value and not --force
    if (!force && tender.erpPartyName !== null && tender.erpPartyName !== undefined && tender.erpPartyName.trim() !== "") {
      skippedExisting++;
      continue;
    }

    const docketLower = tender.docketNo.trim().toLowerCase();
    const partyName = partyLookup.get(docketLower);
    if (partyName === undefined) {
      notFound++;
      continue;
    }

    // partyName already guaranteed non-empty
    found++;

    if (dryRun) {
      if (verbose) console.log(`[DRY-RUN] Would update id=${tender.id} docket="${tender.docketNo}" erpPartyName: "${tender.erpPartyName ?? "null"}" -> "${partyName}"`);
      updated++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { erpPartyName: partyName },
      });
      updated++;
      if (verbose) console.log(`[ErpPartyNameSync] Updated id=${tender.id} docket="${tender.docketNo}" -> erpPartyName="${partyName}"`);
    } catch (err) {
      console.warn(`[ErpPartyNameSync] Failed docket ${tender.docketNo}:`, (err as Error).message);
      errors++;
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Stats");
  console.log("=".repeat(70));
  console.log(`    Total DB records scanned:        ${total}`);
  console.log(`    Found in Smartsheet (eligible):  ${found}`);
  console.log(`    Updated in DB${dryRun ? " (would update)" : ""}:            ${updated}`);
  console.log(`    Not found in sheet:              ${notFound}`);
  console.log(`    Skipped (already has value):     ${skippedExisting}`);
  console.log(`    Skipped (DB docket null/empty):  ${skippedNullDocketDb}`);
  console.log(`    Skipped (sheet party null/empty):${skippedNullPartySheet}`);
  console.log(`    Skipped (sheet docket null):     ${skippedNullDocketSheet}`);
  console.log(`    Duplicates in sheet (first kept):${duplicateDockets}`);
  console.log(`    Errors:                          ${errors}`);

  if (!dryRun) {
    const totalAfter = await prisma.tenderMerged.count({ where: { erpPartyName: { not: null } } });
    console.log(`\n  Records with erpPartyName after: ${totalAfter}`);
    console.log(`  Newly populated: ${totalAfter - totalBefore}`);
  } else {
    console.log(`\n  DRY-RUN: No DB changes. Run without --dry-run to apply.`);
  }
  console.log("=".repeat(70));

  await prisma.$disconnect();
  if (errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
