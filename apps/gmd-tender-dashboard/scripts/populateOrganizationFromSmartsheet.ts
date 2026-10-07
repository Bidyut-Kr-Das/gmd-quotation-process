/**
 * Standalone script to populate organization in TenderMerged
 * from the primary Smartsheet. Matches docketNo against Docket No column
 * and sets organization to Party Name.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateOrganizationFromSmartsheet.ts
 */
import "dotenv/config";
import { syncOrganizationFromSmartsheet } from "../services/smartsheetOrganizationSync";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("=".repeat(60));
  console.log("  Organization Sync Script (Smartsheet)");
  console.log("=".repeat(60));

  const totalBefore = await prisma.tenderMerged.count({
    where: { organization: { not: null } },
  });
  console.log(`\n  Records with organization before: ${totalBefore}`);

  console.log("\n  Syncing from Smartsheet...\n");
  const stats = await syncOrganizationFromSmartsheet();

  const totalAfter = await prisma.tenderMerged.count({
    where: { organization: { not: null } },
  });
  console.log(`\n  Records with organization after: ${totalAfter}`);
  console.log(`  Newly updated: ${stats.updated}`);
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
