/**
 * Script to sync docketNo from the Google Sheet "Docket No-enq" column into
 * TenderMerged records by matching tenderNoNitNo → referenceNo.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/sync-docket-to-merged.ts
 */
import { prisma } from "../lib/prisma";
import { GoogleSheetService } from "../services/googleSheetService";

async function main() {
  console.log("[sync-docket-to-merged] Fetching records from Google Sheet...");
  const sheetService = new GoogleSheetService();
  const records = await sheetService.fetchTenderRecords();

  if (!records || records.length === 0) {
    console.error("[sync-docket-to-merged] No records found in sheet. Aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[sync-docket-to-merged] Fetched ${records.length} records from sheet.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of records) {
    if (!record.tenderNoNitNo?.trim()) {
      skipped++;
      continue;
    }

    if (!record.docketNo?.trim()) {
      skipped++;
      continue;
    }

    try {
      const existing = await prisma.tenderMerged.findUnique({
        where: { referenceNo: record.tenderNoNitNo },
        select: { id: true, docketNo: true },
      });

      if (!existing) {
        skipped++;
        continue;
      }

      if (existing.docketNo) {
        skipped++;
        continue;
      }

      await prisma.tenderMerged.update({
        where: { id: existing.id },
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
  console.error("[sync-docket-to-merged] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
