import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetch2to1BomRows, buildRawMaterialsCostMap, BOM_TYPE_2TO1 } from "../lib/gmd2to1CostLookup";
import { recalculateItem } from "../lib/costCalculator";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== [2:1 BOM] UPDATE COST FROM RAW MATERIALS TABLE START ===\n");

  const bomRows = await fetch2to1BomRows();
  console.log(`[2:1 BOM] Sheet 2:1 rows with valid BOM ID: ${bomRows.length}`);

  const bomMap = new Map<string, { bomId: string | null; consumptionCodes: string[] }>();
  for (const r of bomRows) {
    bomMap.set(r.itemCode, { bomId: r.bomId, consumptionCodes: r.consumptionCodes });
  }

  const allRmCodesSet = new Set<string>();
  for (const r of bomRows) {
    for (const code of r.consumptionCodes) {
      allRmCodesSet.add(code);
    }
  }
  console.log(`[2:1 BOM] Total non-F consumption codes: ${allRmCodesSet.size}`);

  const costMap = await buildRawMaterialsCostMap([...allRmCodesSet]);
  console.log(`[2:1 BOM] Consumption codes with cost in Raw Materials table: ${costMap.size}`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { in: [...bomMap.keys()] } },
    select: { id: true, erpItemCode: true, itemName: true, cost: true },
  });
  console.log(`[2:1 BOM] EnquiryItems matching 2:1 sheet item codes: ${items.length}`);

  let filled = 0;
  let skippedExisting = 0;
  let noCostAvailable = 0;
  let errored = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const bom = bomMap.get(item.erpItemCode!);
    if (!bom) continue;

    process.stdout.write(`\r[${i + 1}/${items.length}] ${item.itemName.substring(0, 45).padEnd(45)}`);

    try {
      const existingCostNum = item.cost ? Number(item.cost) : null;
      const isBlank = existingCostNum === null || existingCostNum <= 0;

      if (!isBlank) {
        skippedExisting++;
        continue;
      }

      let sumCost = 0;
      let validCount = 0;
      for (const cCode of bom.consumptionCodes) {
        const cCost = costMap.get(cCode);
        if (cCost !== undefined && cCost !== null) {
          sumCost += cCost;
          validCount++;
        }
      }

      if (validCount > 0 && sumCost > 0) {
        await recalculateItem(item.id, { cost: sumCost });
        await prisma.enquiryItem.update({
          where: { id: item.id },
          data: {
            bomId: bom.bomId,
            bomType: BOM_TYPE_2TO1,
          },
        });
        filled++;
      } else {
        noCostAvailable++;
      }
    } catch (err) {
      errored++;
      console.error(`\n  ✗ Failed for item ${item.id} (${item.erpItemCode}):`, (err as Error).message);
    }
  }

  console.log(`\n\n=== [2:1 BOM] DONE ===`);
  console.log(`[2:1 BOM] Blank/dash Cost filled: ${filled}`);
  console.log(`[2:1 BOM] Skipped (Cost already set): ${skippedExisting}`);
  console.log(`[2:1 BOM] No cost available in Raw Materials table: ${noCostAvailable}`);
  console.log(`[2:1 BOM] Errors: ${errored}\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
