/**
 * ONE-TIME script to populate TenderMerged.contractNo from
 * "Tenders Details - Puja (1).xls" -> Sales_Contract sheet
 * Matching: QUOTATION_VRNO (col 2) -> VRNO_Sales_Contract (col 3)
 *
 * Rules:
 *  - Header check before any DB write (QUOTATION_VRNO / VRNO_Sales_Contract)
 *  - XLS quotation null/empty -> skip
 *  - XLS contract null/empty -> skip
 *  - DB quotationNo null/empty -> skip
 *  - DB contractNo already present -> skip (only null brought)
 *  - Never writes null/empty to DB
 *  - Multiple contracts for same quotation -> joined with ", " (comma+space)
 *
 * Usage:
 *   npx tsx scripts/syncContractFromXlsByQuotation.ts
 *   npx tsx scripts/syncContractFromXlsByQuotation.ts --dry-run
 *   npx tsx scripts/syncContractFromXlsByQuotation.ts --dry-run --verbose
 *   npx tsx scripts/syncContractFromXlsByQuotation.ts --verbose
 *   npx tsx scripts/syncContractFromXlsByQuotation.ts --dry-run --file="custom.xls"
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncContractByQuotationFromXls } from "../services/contractByQuotationXlsService";

function parseArgs(): { dryRun: boolean; verbose: boolean; help: boolean; filePath?: string } {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="));
  return {
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
    filePath: fileArg ? fileArg.split("=")[1] : undefined,
  };
}

async function main() {
  const { dryRun, verbose, help, filePath } = parseArgs();
  if (help) {
    console.log(`
ONE-TIME: Sync contractNo from XLS (QUOTATION_VRNO -> VRNO_Sales_Contract) -> TenderMerged.contractNo

Usage: npx tsx scripts/syncContractFromXlsByQuotation.ts [options]

Options:
  --dry-run          Simulate without DB writes
  --verbose          Log header check, lookup build, per-row updates
  --file="path.xls"  Override default "Tenders Details - Puja (1).xls"
  --help, -h         Show this help

Rules:
  - XLS quotation null/empty or contract null/empty -> skip
  - DB quotation null/empty -> skip
  - DB contractNo already present -> never overwrite (only null brought)
  - Multiple contracts for same quotation joined with ", "
  - Never writes null/empty; header verified before write
`);
    process.exit(0);
  }

  console.log("=".repeat(70));
  console.log("  Contract Sync — XLS (QUOTATION_VRNO -> VRNO_Sales_Contract) — One-Time");
  console.log("=".repeat(70));
  if (dryRun) console.log("  MODE: DRY-RUN (no DB writes)\n");
  if (verbose) console.log("  MODE: VERBOSE\n");
  if (filePath) console.log(`  FILE override: ${filePath}\n`);

  const beforeWith = await prisma.tenderMerged.count({ where: { contractNo: { not: null } } });
  const beforeNull = await prisma.tenderMerged.count({
    where: { OR: [{ contractNo: null }, { contractNo: "" }] },
  });
  const withQuotation = await prisma.tenderMerged.count({ where: { quotationNo: { not: null } } });
  console.log(`  Records with contractNo before: ${beforeWith}`);
  console.log(`  Records with null/empty contractNo before: ${beforeNull}`);
  console.log(`  Records with quotationNo (eligible keys): ${withQuotation}`);

  console.log("\n  Verifying XLS headers and syncing...\n");

  const stats = await syncContractByQuotationFromXls({ dryRun, verbose, filePath });

  console.log("\n" + "=".repeat(70));
  console.log("  Header Check");
  console.log("=".repeat(70));
  console.log(`  XLS path: ${stats.headerCheck.xlsPath}`);
  console.log(`  Sheet "${stats.headerCheck.sheetName}": ${stats.headerCheck.sheetFound ? "FOUND" : "NOT FOUND"}`);
  console.log(`  Expected col ${2}="QUOTATION_VRNO" col ${3}="VRNO_Sales_Contract"`);
  console.log(`  Actual headers: ${JSON.stringify(stats.headerCheck.actualHeaders)}`);
  console.log(`  Header passed: ${stats.headerCheck.passed ? "YES" : "NO — aborted"}`);
  console.log(`  Total rows in sheet: ${stats.headerCheck.totalRows}`);

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Stats");
  console.log("=".repeat(70));
  console.log(`    Total DB records scanned:           ${stats.total}`);
  console.log(`    Unique quotations in XLS:           ${stats.uniqueQuotations}`);
  console.log(`    Multi-contract quotations (joined): ${stats.multiContractQuotations}`);
  console.log(`    Found in XLS (eligible):            ${stats.found}`);
  console.log(`    Updated in DB${dryRun ? " (would update)" : ""}:               ${stats.updated}`);
  console.log(`    Not found in XLS:                   ${stats.notFound}`);
  console.log(`    Skipped (already has contractNo):   ${stats.skippedExistingContract}`);
  console.log(`    Skipped (DB quotation null/empty):  ${stats.skippedNullQuotationDb}`);
  console.log(`    Skipped (XLS quotation null):       ${stats.skippedNullQuotationXls}`);
  console.log(`    Skipped (XLS contract null):        ${stats.skippedNullContractXls}`);
  console.log(`    Errors:                             ${stats.errors}`);

  if (!dryRun) {
    const afterWith = await prisma.tenderMerged.count({ where: { contractNo: { not: null } } });
    console.log(`\n  Records with contractNo after: ${afterWith}`);
    console.log(`  Newly populated: ${afterWith - beforeWith}`);
  } else {
    console.log(`\n  DRY-RUN: No DB changes made. Run without --dry-run to apply.`);
  }

  console.log("=".repeat(70));

  await prisma.$disconnect();

  if (stats.errors > 0 || !stats.headerCheck.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
