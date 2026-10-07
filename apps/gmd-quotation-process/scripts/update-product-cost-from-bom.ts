import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { recalculateItem } from "../lib/costCalculator";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M } from "../lib/gmdBomCostLookup";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== [BOM] UPDATE PRODUCT COST FROM BOM START ===\n");

  const bomRows = await fetchBomRows();
  console.log(`[BOM] Sheet DIRECT M2M rows with rm code: ${bomRows.length}`);

  const bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
  for (const r of bomRows) {
    bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
  }

  const rmCodes = [...new Set(bomRows.map((r) => r.rmItemCode))];
  console.log(`[BOM] Distinct RM codes: ${rmCodes.length}`);

  const costMap = await buildRmCostMap(rmCodes);
  console.log(`[BOM] RM codes with a computable cost: ${costMap.size}`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { in: [...bomMap.keys()] } },
    select: { id: true, erpItemCode: true, itemName: true, productCost: true },
  });
  console.log(`[BOM] EnquiryItems whose erpItemCode matched the sheet: ${items.length}`);

  let filled = 0;
  let bomOnly = 0;
  let skippedExisting = 0;
  let errored = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const bom = bomMap.get(item.erpItemCode!);
    if (!bom) continue;

    const cost = costMap.get(bom.rmItemCode);
    process.stdout.write(`\r[${i + 1}/${items.length}] ${item.itemName.substring(0, 50).padEnd(50)}`);

    try {
      const isBlank = item.productCost === null;

      if (isBlank && cost !== undefined && cost !== null) {
        await recalculateItem(item.id, { productCost: cost });
        filled++;
      } else if (isBlank) {
        bomOnly++;
      } else {
        skippedExisting++;
      }

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          bomId: bom.bomId,
          bomType: DIRECT_M2M,
          rmItemCode: bom.rmItemCode,
        },
      });
    } catch (err) {
      errored++;
      console.error(`\n  ✗ Failed for item ${item.id} (${item.erpItemCode}):`, (err as Error).message);
    }
  }

  console.log(`\n\n=== [BOM] DONE ===`);
  console.log(`[BOM] Blank productCost filled (with recompute): ${filled}`);
  console.log(`[BOM] BOM fields saved without cost: ${bomOnly}`);
  console.log(`[BOM] Skipped (productCost already set): ${skippedExisting}`);
  console.log(`[BOM] Errors: ${errored}\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
