/**
 * Script to queue non-GEM tenders (from tender_merged) for BOQ document parsing.
 *
 * Finds all TenderMerged records with tenderType = NON_GEM that have
 * at least one TenderFile tagged as "tenderDocument", then pushes each
 * to the "tender:parsing" queue with type NON_GEM_BOQ_PARSING.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/queueNonGemTenderDocuments.ts
 */
import { prisma } from "../lib/prisma";
import { publishNonGemBoqParsingTask } from "../lib/queue/publisher";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";

async function main() {
  console.log("[queueNonGemTenderDocuments] Querying NON_GEM tenders with tenderDocument files...\n");

  const tenders = await prisma.tenderMerged.findMany({
    where: {
      tenderType: "NON_GEM",
      tenderFiles: {
        some: { tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT } },
      },
    },
    select: {
      referenceNo: true,
      tenderFiles: {
        where: { tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT } },
        select: { url: true },
        take: 1,
      },
    },
  });

  console.log(`Found ${tenders.length} NON_GEM tenders with tenderDocument files.\n`);

  let queued = 0;
  let skipped = 0;
  let errors = 0;

  for (const t of tenders) {
    const file_link = t.tenderFiles[0]?.url;
    if (!file_link) {
      console.warn(`  [SKIP] ${t.referenceNo}: no tenderDocument file URL`);
      skipped++;
      continue;
    }

    try {
      const ok = await publishNonGemBoqParsingTask({
        type: "NON_GEM_BOQ_PARSING",
        referenceNo: t.referenceNo,
        file_link,
      });

      if (ok) {
        console.log(`  [OK]   ${t.referenceNo} -> ${file_link}`);
        queued++;
      } else {
        console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
        errors++;
      }
    } catch (err) {
      console.error(`  [ERR]  ${t.referenceNo}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Total found: ${tenders.length}`);
  console.log(`  Queued:      ${queued}`);
  console.log(`  Skipped:     ${skipped}`);
  console.log(`  Errors:      ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[queueNonGemTenderDocuments] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
