import { prisma } from "../lib/prisma";

async function main() {
  console.log("[prefill] Finding TenderMerged records with raQualificationRule set...");

  const records = await prisma.tenderMerged.findMany({
    where: {
      raQualificationRule: { not: null },
      NOT: { raQualificationRule: "" },
    },
    select: { id: true, referenceNo: true, raQualificationRule: true, reverseAuctionApplicable: true },
  });

  console.log(`[prefill] Found ${records.length} records.`);

  let updated = 0;
  let skipped = 0;

  for (const record of records) {
    if (record.reverseAuctionApplicable === true) {
      skipped++;
      continue;
    }

    await prisma.tenderMerged.update({
      where: { id: record.id },
      data: { reverseAuctionApplicable: true },
    });

    updated++;
    console.log(`[prefill] Updated id=${record.id} ref=${record.referenceNo} raQualificationRule="${record.raQualificationRule}"`);
  }

  console.log(`[prefill] Done. Updated: ${updated}, Skipped (already true): ${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[prefill] Error:", err);
  process.exit(1);
});
