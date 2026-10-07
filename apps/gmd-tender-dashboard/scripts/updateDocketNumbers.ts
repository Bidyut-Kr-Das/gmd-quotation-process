/**
 * Script to update all docketNo fields in the database from the "Docket No-enq"
 * column in the Google Sheet (LASER_Master_Tender_List).
 *
 * Usage:
 *   cd v2 && npx tsx scripts/updateDocketNumbers.ts
 */
import { prisma } from "../lib/prisma";
import { GoogleSheetService } from "../services/googleSheetService";

async function main() {
  console.log("[updateDocketNumbers] Fetching records from Google Sheet...");
  const sheetService = new GoogleSheetService();
  const records = await sheetService.fetchTenderRecords();

  if (!records || records.length === 0) {
    console.error("[updateDocketNumbers] No records found in sheet. Aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[updateDocketNumbers] Fetched ${records.length} records from sheet.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of records) {
    if (!record.tenderNoNitNo) {
      skipped++;
      continue;
    }

    try {
      const existing = await prisma.tender.findUnique({
        where: { tenderNoNitNo: record.tenderNoNitNo },
        select: { id: true, docketNo: true },
      });

      if (!existing) {
        skipped++;
        continue;
      }

      if (existing.docketNo === record.docketNo) {
        skipped++;
        continue;
      }

      await prisma.tender.update({
        where: { tenderNoNitNo: record.tenderNoNitNo },
        data: { docketNo: record.docketNo },
      });

      console.log(
        `  [OK] ${record.tenderNoNitNo}: "${existing.docketNo}" → "${record.docketNo}"`
      );
      updated++;
    } catch (err) {
      console.error(
        `  [ERR] ${record.tenderNoNitNo}: ${(err as Error).message}`
      );
      errors++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Total records from sheet: ${records.length}`);
  console.log(`  Updated:                  ${updated}`);
  console.log(`  Skipped (no change/miss): ${skipped}`);
  console.log(`  Errors:                   ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[updateDocketNumbers] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
