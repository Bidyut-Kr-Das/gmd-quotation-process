/**
 * Publish every Items row to the knowledgebase queue.
 *
 * Dry-run by default; pass --publish to actually push to RabbitMQ.
 *
 * Usage:
 *   npx tsx scripts/publishItemsToKnowledgebase.ts           # dry-run
 *   npx tsx scripts/publishItemsToKnowledgebase.ts --publish # push all
 */
import { prisma } from "../lib/prisma";
import { publishKnowledgebaseTask } from "../lib/queue/publisher";
import { closeConnection } from "../lib/rabbitmq";

async function main() {
  const shouldPublish = process.argv.includes("--publish");

  const items = await prisma.items.findMany({
    orderBy: { itemcode: "asc" },
    select: { id: true, itemcode: true, itemName: true },
  });

  console.log(
    `Items found: ${items.length} (publish=${shouldPublish ? "ENABLED" : "DRY-RUN"})`
  );

  let published = 0;
  let failed = 0;

  for (const item of items) {
    if (!shouldPublish) {
      console.log(`[DRY] ${item.itemcode} - ${item.itemName}`);
      published++;
      continue;
    }

    try {
      const sent = await publishKnowledgebaseTask({
        mode: "direct",
        collection: "item-knowledge",
        contentKey: "item_name",
        content: item.itemName,
      });
      if (sent) {
        published++;
        console.log(`[OK] ${item.itemcode} - ${item.itemName}`);
      } else {
        failed++;
        console.warn(`[FAIL] ${item.itemcode}: publish returned false (RabbitMQ unavailable?)`);
      }
    } catch (err) {
      failed++;
      console.error(`[ERR] ${item.itemcode}: ${err instanceof Error ? err.message : err}`);
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