/**
 * Standalone script to populate blank docketNo values in TenderMerged
 * from Smartsheet data. Matches referenceNo against Email Subject Line
 * or Enquiry Tender No columns.
 *
 * Runs once to backfill all existing blanks. After this, the "Sync Sheet Data"
 * button will keep filling new blanks automatically.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateSmartsheetDockets.ts
 */
import "dotenv/config";
import { syncDocketFromSmartsheet } from "../services/smartsheetDocketSync";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("=".repeat(60));
  console.log("  Smartsheet Docket Backfill Script");
  console.log("=".repeat(60));

  // Count blanks before
  const totalBefore = await prisma.tenderMerged.count({
     where: {
    OR: [
      { docketNo: null },
      { docketNo: "" },
    ],
  },
  });
  console.log(`\n  Blank docket records before: ${totalBefore}`);

  if (totalBefore === 0) {
    console.log("  No blank docket numbers found. Nothing to do.\n");
    await prisma.$disconnect();
    return;
  }

  // Run the sync
  console.log("  Fetching Smartsheet data and matching...");
  const stats = await syncDocketFromSmartsheet();

  // Print results
  console.log("\n" + "-".repeat(60));
  console.log("  RESULTS");
  console.log("-".repeat(60));
  console.log(`  Total blank records:     ${stats.totalBlank}`);
  console.log(`  Found in Email Subject:  ${stats.foundInEmailSubject}`);
  console.log(`  Found in Enquiry Tender: ${stats.foundInEnquiryTender}`);
  console.log(`  Not found:               ${stats.notFound}`);
  console.log(`  Errors:                  ${stats.errors}`);
  console.log(`  Total filled:            ${stats.foundInEmailSubject + stats.foundInEnquiryTender}`);
  console.log("-".repeat(60));

  // Count blanks after
  const totalAfter = await prisma.tenderMerged.count({
    where: {
      OR: [
        { docketNo: null },
        { docketNo: "" },
      ],
    },
  });
  console.log(`\n  Blank docket records after: ${totalAfter}`);
  console.log(`  Filled this run:           ${totalBefore - totalAfter}`);
  console.log("\n  Done.\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[populateSmartsheetDockets] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
