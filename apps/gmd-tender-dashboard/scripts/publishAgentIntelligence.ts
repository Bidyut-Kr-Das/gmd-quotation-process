/**
 * Publish every tender_merged referenceNo to the agent:intelligence queue.
 *
 * tender_type derived from referenceNo: contains "gem" -> "gem", else "non_gem".
 *
 * Dry-run by default; pass --publish to actually push to RabbitMQ.
 *
 * Usage:
 *   npx tsx scripts/publishAgentIntelligence.ts           # dry-run all
 *   npx tsx scripts/publishAgentIntelligence.ts --publish # push all
 *   npx tsx scripts/publishAgentIntelligence.ts --referenceNo=REF1,REF2 --publish
 */
import { prisma } from "../lib/prisma";
import { QUEUES } from "../lib/queue/config";
import { getChannel, closeConnection } from "../lib/rabbitmq";

async function main() {
  const shouldPublish = process.argv.includes("--publish");
  const refArg = process.argv
    .find((a) => a.startsWith("--referenceNo="))
    ?.split("=").slice(1).join("=");

  let tenders: { referenceNo: string }[];

  if (refArg) {
    tenders = refArg.split(",").map((r) => r.trim()).filter(Boolean).map((referenceNo) => ({ referenceNo }));
  } else {
    tenders = await prisma.tenderMerged.findMany({
      where: { referenceNo: { not: "" } },
      select: { referenceNo: true },
      orderBy: { referenceNo: "asc" },
    });
  }

  console.log(
    `Tenders found: ${tenders.length} (publish=${shouldPublish ? "ENABLED" : "DRY-RUN"})`
  );

  const ch = shouldPublish ? await getChannel() : null;
  if (shouldPublish && !ch) {
    console.error("[RabbitMQ] No channel available");
    process.exit(1);
  }

  if (ch) {
    await ch.assertQueue(QUEUES.AGENT_INTELLIGENCE, { durable: true });
  }

  let published = 0;
  let failed = 0;

  for (const t of tenders) {
    const referenceNo = t.referenceNo;
    const tender_type = /gem/i.test(referenceNo) ? "gem" : "non_gem";
    const payload = { referenceNo, tender_type };

    if (!shouldPublish) {
      console.log(`[DRY] ${referenceNo} (${tender_type})`);
      published++;
      continue;
    }

    try {
      const sent = ch!.sendToQueue(
        QUEUES.AGENT_INTELLIGENCE,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true }
      );
      if (sent) {
        published++;
        console.log(`[OK] ${referenceNo} (${tender_type})`);
      } else {
        failed++;
        console.warn(`[FAIL] ${referenceNo}: sendToQueue returned false`);
      }
    } catch (err) {
      failed++;
      console.error(`[ERR] ${referenceNo}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`Done. Published: ${published}, failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeConnection();
  });