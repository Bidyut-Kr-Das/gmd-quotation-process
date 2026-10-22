/**
 * Script to publish the 10 most recent GEM tenders as GEM_PDF_PARSING jobs
 * to the "tender:parsing" queue.
 *
 * Usage:
 *   npx tsx scripts/publishGemPdfParsingJobs.ts
 */
import { prisma } from "../lib/prisma";
import { publishGemPdfParsingTask } from "../lib/queue/publisher";
import { closeConnection } from "../lib/rabbitmq";

const LIMIT = 10;

async function main() {
  console.log("[publishGemPdfParsingJobs] Querying 10 most recent GEM tenders...\n");

  const tenders = await prisma.tenderMerged.findMany({
    where: { tenderType: "GEM" },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: { referenceNo: true },
  });

  console.log(`Found ${tenders.length} GEM tenders.\n`);

  let queued = 0;
  let failed = 0;

  for (const t of tenders) {
    try {
      const ok = await publishGemPdfParsingTask({
        type: "GEM_PDF_PARSING",
        referenceNo: t.referenceNo,
      });

      if (ok) {
        console.log(`  [OK]   ${t.referenceNo} -> tender:parsing`);
        queued++;
      } else {
        console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERR]  ${t.referenceNo}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Total found: ${tenders.length}`);
  console.log(`  Queued:      ${queued}`);
  console.log(`  Failed:      ${failed}`);
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeConnection();
  });
