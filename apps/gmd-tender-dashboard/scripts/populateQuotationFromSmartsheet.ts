/**
 * Standalone script to populate quotationNo in TenderMerged
 * from the primary Smartsheet. Matches docketNo against Docket No column.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateQuotationFromSmartsheet.ts
 */
import "dotenv/config";
import { syncQuotationFromSmartsheet } from "../services/smartsheetQuotationSync";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("=".repeat(60));
  console.log("  Quotation No Populate Script");
  console.log("=".repeat(60));

  const totalBefore = await prisma.tenderMerged.count({
    where: { quotationNo: { not: null } },
  });
  console.log(`\n  Records with quotation before: ${totalBefore}`);

  console.log("\n  Syncing from Smartsheet...\n");
  const stats = await syncQuotationFromSmartsheet();

  const totalAfter = await prisma.tenderMerged.count({
    where: { quotationNo: { not: null } },
  });
  console.log(`\n  Records with quotation after: ${totalAfter}`);
  console.log(`  Newly populated: ${totalAfter - totalBefore}`);
  console.log(`\n  Detailed stats:`);
  console.log(`    Total DB records scanned: ${stats.total}`);
  console.log(`    Found in Smartsheet:     ${stats.found}`);
  console.log(`    Updated in DB:           ${stats.updated}`);
  console.log(`    Not found in sheet:      ${stats.notFound}`);
  console.log(`    Errors:                  ${stats.errors}`);
  console.log("=".repeat(60));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
