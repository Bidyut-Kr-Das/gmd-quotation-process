/**
 * Publish all AI-valid tenders to tender:tasks queue.
 *
 *   --publish   Actually publish to RabbitMQ (default: dry-run)
 *   --help      Show usage
 *
 * Usage:
 *   npx tsx scripts/publishAiValidTenders.ts            (dry-run)
 *   npx tsx scripts/publishAiValidTenders.ts --publish
 */
import { prisma } from "../lib/prisma";
import { publishTenderTask } from "../lib/queue/publisher";
import { closeConnection } from "../lib/rabbitmq";

function printHelp() {
  console.log(`
Usage: npx tsx scripts/publishAiValidTenders.ts [flags]

Flags:
  --publish   Actually publish to RabbitMQ (default: dry-run, only logs)
  --help, -h  Show this help

Publishes every TenderMerged with aiRelevanceValid = true to tender:tasks
(GEM_DOWNLOAD / NON_GEM_DOWNLOAD via publishTenderTask).
`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldPublish = args.includes("--publish");
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  console.log("=".repeat(60));
  console.log("  Publish AI-valid tenders to tender:tasks");
  console.log("=".repeat(60));

  const tenders = await prisma.tenderMerged.findMany({
    where: { aiRelevanceValid: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      referenceNo: true,
      tenderType: true,
      t247Id: true,
    },
  });

  console.log(`\n  Found: ${tenders.length} AI-valid TenderMerged record(s)`);

  if (tenders.length === 0) {
    console.log("  No tenders found. Exiting.");
    console.log("=".repeat(60));
    return;
  }

  const gemCount = tenders.filter((t) => t.tenderType === "GEM").length;
  const nonGemCount = tenders.filter((t) => t.tenderType === "NON_GEM").length;
  const missingRef = tenders.filter((t) => !t.referenceNo).length;

  console.log(`    GEM:     ${gemCount}`);
  console.log(`    NON_GEM: ${nonGemCount}`);
  if (missingRef) console.log(`    Missing referenceNo (would be skipped): ${missingRef}`);

  console.log(`\n  Sample (up to 20):`);
  for (const t of tenders.slice(0, 20)) {
    console.log(
      `    - id=${t.id} type=${t.tenderType} ref=${t.referenceNo ?? "(null)"} t247Id=${t.t247Id ?? "-"}`
    );
  }
  if (tenders.length > 20) console.log(`    ... and ${tenders.length - 20} more`);

  console.log(`\n  Publishing: ${shouldPublish ? "ENABLED (--publish)" : "DISABLED (dry-run, pass --publish to push)"}`);

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tenders) {
    if (!t.referenceNo) {
      console.warn(`  [SKIP] id=${t.id}: missing referenceNo`);
      skipped++;
      continue;
    }
    if (!shouldPublish) {
      queued++;
      continue;
    }
    try {
      const isGem = t.tenderType === "GEM";
      const payload = isGem
        ? {
            type: "GEM_DOWNLOAD" as const,
            tenderId: t.id,
            gemId: t.t247Id || t.referenceNo,
            referenceNo: t.referenceNo,
            timestamp: Date.now(),
          }
        : {
            type: "NON_GEM_DOWNLOAD" as const,
            tenderId: t.id,
            referenceNo: t.referenceNo,
            timestamp: Date.now(),
          };
      const ok = await publishTenderTask(payload);
      if (ok) {
        console.log(`  [OK] ${t.referenceNo} (${payload.type}) -> tender:tasks`);
        queued++;
      } else {
        console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERR] ${t.referenceNo}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n  Results (${shouldPublish ? "publish enabled" : "dry-run"}):`);
  console.log(`    Total found:        ${tenders.length}`);
  console.log(`    ${shouldPublish ? "Queued" : "Would-be queued"} to tender:tasks: ${queued}`);
  console.log(`    Skipped (no ref):   ${skipped}`);
  console.log(`    Failed:             ${failed}`);
  console.log("=".repeat(60));
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