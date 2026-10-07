/**
 * Script to fetch quotation number from Smartsheet matching docket numbers
 * and populate TenderMerged.quotationNo where it is currently null/empty.
 *
 * Rules (strict):
 *  - If Smartsheet quotationNo is null/empty/"-"/"NOT QUOTED"/"N.A" -> no changes
 *  - If TenderMerged docketNo is null/empty -> no changes
 *  - If TenderMerged quotationNo already has a value -> no changes (do not overwrite)
 *  - Only data written is quotationNo; never writes null/empty to DB
 *  - Column names verified before any DB write (aborts if missing)
 *
 * Usage:
 *   npx tsx scripts/syncQuotationFromSmartsheetByDocket.ts
 *   npx tsx scripts/syncQuotationFromSmartsheetByDocket.ts --dry-run
 *   npx tsx scripts/syncQuotationFromSmartsheetByDocket.ts --dry-run --verbose
 *   npx tsx scripts/syncQuotationFromSmartsheetByDocket.ts --verbose
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncQuotationByDocketFromSmartsheet } from "../services/quotationByDocketSyncService";

function parseArgs(): { dryRun: boolean; verbose: boolean; help: boolean } {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

async function main() {
  const { dryRun, verbose, help } = parseArgs();
  if (help) {
    console.log(`
Usage: npx tsx scripts/syncQuotationFromSmartsheetByDocket.ts [options]

Options:
  --dry-run   Simulate without DB writes (shows would-update count)
  --verbose   Log column check, lookup build, and per-row updates
  --help, -h  Show this help

Rules:
  - Sheet quotation null/empty/"-"/"NOT QUOTED"/"N.A" -> skip
  - DB docket null/empty -> skip
  - DB quotation already present -> never overwrite
  - Never writes null/empty to DB; column names verified before write
`);
    process.exit(0);
  }

  console.log("=".repeat(70));
  console.log("  Quotation Sync — Smartsheet (Docket → Quotation) — Strict Mode");
  console.log("=".repeat(70));
  if (dryRun) console.log("  MODE: DRY-RUN (no DB writes)\n");
  if (verbose) console.log("  MODE: VERBOSE\n");

  const totalBefore = await prisma.tenderMerged.count({
    where: { quotationNo: { not: null } },
  });
  const totalNullBefore = await prisma.tenderMerged.count({
    where: {
      OR: [{ quotationNo: null }, { quotationNo: "" }],
    },
  });
  console.log(`  Records with quotation before: ${totalBefore}`);
  console.log(`  Records with null/empty quotation before: ${totalNullBefore}`);

  console.log("\n  Verifying Smartsheet columns and syncing...\n");

  const stats = await syncQuotationByDocketFromSmartsheet({ dryRun, verbose });

  console.log("\n" + "=".repeat(70));
  console.log("  Column Check");
  console.log("=".repeat(70));
  console.log(`  Docket column  "Docket No  (Debosmita Nath)" : ${stats.columnCheck.docketColumnFound ? `FOUND (id ${stats.columnCheck.docketColumnId})` : "NOT FOUND — aborted"}`);
  console.log(`  Quotation column "Quotation No. (Dipankar)" : ${stats.columnCheck.quotationColumnFound ? `FOUND (id ${stats.columnCheck.quotationColumnId})` : "NOT FOUND — aborted"}`);
  if (!stats.columnCheck.docketColumnFound || !stats.columnCheck.quotationColumnFound) {
    console.log(`\n  Available columns (${stats.columnCheck.allColumnTitles.length}):`);
    for (const t of stats.columnCheck.allColumnTitles) {
      console.log(`    - "${t}"`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Stats");
  console.log("=".repeat(70));
  console.log(`    Total DB records scanned:          ${stats.total}`);
  console.log(`    Found in Smartsheet (eligible):    ${stats.found}`);
  console.log(`    Updated in DB${dryRun ? " (would update)" : ""}:              ${stats.updated}`);
  console.log(`    Not found in sheet:                ${stats.notFound}`);
  console.log(`    Skipped (already has quotation):   ${stats.skippedExisting}`);
  console.log(`    Skipped (DB docket null/empty):    ${stats.skippedNullDocketDb}`);
  console.log(`    Skipped (sheet quotation null):    ${stats.skippedNullQuotationSheet}`);
  console.log(`    Skipped (sheet docket null):       ${stats.skippedNullDocketSheet}`);
  console.log(`    Duplicates in sheet (first kept):  ${stats.duplicateDockets}`);
  console.log(`    Errors:                            ${stats.errors}`);

  if (!dryRun) {
    const totalAfter = await prisma.tenderMerged.count({
      where: { quotationNo: { not: null } },
    });
    console.log(`\n  Records with quotation after: ${totalAfter}`);
    console.log(`  Newly populated: ${totalAfter - totalBefore}`);
  } else {
    console.log(`\n  DRY-RUN: No DB changes made. Run without --dry-run to apply.`);
  }

  console.log("=".repeat(70));

  await prisma.$disconnect();

  if (stats.errors > 0 || !stats.columnCheck.docketColumnFound || !stats.columnCheck.quotationColumnFound) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
