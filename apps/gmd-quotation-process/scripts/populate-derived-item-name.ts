import "dotenv/config";
import { prisma } from "../lib/prisma";
import { buildDerivedItemName } from "../lib/gmd_lib/derived-item-name";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const items = await prisma.rawMaterial.findMany({
    select: {
      id: true,
      erpItemCode: true,
      l8ItemCategory: true,
      l2ValveType: true,
      l3Dia: true,
      l4Component: true,
      l5Material: true,
      l6Std: true,
      l7Dimension: true,
    },
  });

  console.log(`Found ${items.length} items to process.`);

  let updated = 0;
  let blank = 0;
  const chunkSize = 200;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((item) => {
        const itemNameDerived = buildDerivedItemName(item);
        if (!itemNameDerived) {
          blank++;
          return Promise.resolve();
        }
        if (dryRun) {
          console.log(`[DRY-RUN] ${item.erpItemCode} -> ${itemNameDerived}`);
          return Promise.resolve();
        }
        return prisma.rawMaterial.update({
          where: { id: item.id },
          data: { itemNameDerived },
        });
      }),
    );
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(
          `[derive-item-name] failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
        return;
      }
      updated++;
    });
  }

  console.log(`Done: updated=${updated} blank=${blank} (no name derivable)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });