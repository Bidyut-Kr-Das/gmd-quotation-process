import { prisma } from "@/lib/prisma";
import {
  publishNonGemBoqParsingTask,
  publishTenderTask,
} from "@/lib/queue/publisher";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";

const DAYS = 15;

async function main() {
  console.log("=".repeat(60));
  console.log("  Publish Parsing Jobs Script");
  console.log("=".repeat(60));

  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  console.log(`\n  Association createdAt cutoff (last ${DAYS} days): ${since.toISOString()}`);

  const tenders = await prisma.tenderMerged.findMany({
    where: {
      tenderType: "NON_GEM",
      organization: { contains: "railway", mode: "insensitive" },
      tenderFiles: {
        none: { tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT } },
      },
    },
    select: {
      id: true,
      referenceNo: true,
      tenderFiles: {
        where: { tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT } },
        select: { url: true },
        take: 1,
      },
    },
  });

  console.log(`\n  NON_GEM tenders with itemCategory=null + participated + association (${DAYS}d): ${tenders.length}`);

  let toParsing = 0;
  let toTasks = 0;
  let skipped = 0;
  let errors = 0;

  

  for (const tender of tenders) {
    const referenceNo = tender.referenceNo;
    const hasTenderDocument = tender.tenderFiles.length > 0;

    try {
      if (hasTenderDocument) {
        if (!referenceNo) {
          console.warn(`  [SKIP] id=${tender.id}: tenderDocument present but no referenceNo for parsing`);
          skipped++;
          continue;
        }
        const ok = await publishNonGemBoqParsingTask({
          type: "NON_GEM_BOQ_PARSING",
          referenceNo,
          file_link: tender.tenderFiles[0]?.url ?? "",
        });
        if (ok) {
          toParsing++;
          console.log(`  [PARSING] ${referenceNo}`);
        } else {
          console.warn(`  [FAIL] ${referenceNo ?? tender.id}: publish to tender:parsing returned false (RabbitMQ unavailable?)`);
          errors++;
        }
      } else {
        if (!referenceNo) {
          console.warn(`  [SKIP] id=${tender.id}: no referenceNo for download task`);
          skipped++;
          continue;
        }
        const ok = await publishTenderTask({
          type: "NON_GEM_DOWNLOAD",
          tenderId: tender.id,
          referenceNo,
          timestamp: Date.now(),
        });
        if (ok) {
          toTasks++;
          console.log(`  [TASK] ${referenceNo}`);
        } else {
          console.warn(`  [FAIL] ${referenceNo}: publish to tender:tasks returned false (RabbitMQ unavailable?)`);
          errors++;
        }
      }
    } catch (err) {
      console.error(`  [ERR] ${tender.referenceNo ?? tender.id}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log("\n  Results:");
  console.log(`    Total scanned:              ${tenders.length}`);
  console.log(`    Pushed to tender:parsing:   ${toParsing}`);
  console.log(`    Pushed to tender:tasks:     ${toTasks}`);
  console.log(`    Skipped:                    ${skipped}`);
  console.log(`    Errors:                     ${errors}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
