/**
 * Standalone script to populate beneficiaryBankDetails in TenderMerged
 * from the LC Smartsheet. Matches referenceNo against TENDER MASTER NO column.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateLcBankDetails.ts
 */
import "dotenv/config";
import { syncBeneficiaryBankDetails } from "../services/lcSmartsheetService";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("=".repeat(60));
  console.log("  LC Beneficiary Bank Details Populate Script");
  console.log("=".repeat(60));

  const totalBefore = await prisma.tenderMerged.count({
    where: { beneficiaryBankDetails: { not: null } },
  });
  console.log(`\n  Records with bank details before: ${totalBefore}`);

  console.log("\n  Syncing from LC Smartsheet...\n");
  const stats = await syncBeneficiaryBankDetails();

  const totalAfter = await prisma.tenderMerged.count({
    where: { beneficiaryBankDetails: { not: null } },
  });
  console.log(`\n  Records with bank details after: ${totalAfter}`);
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
