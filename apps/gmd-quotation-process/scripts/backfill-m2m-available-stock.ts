import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { getRmStockMap, getRmTypeMap } from "../lib/directM2MStockLookup";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== BACKFILLING AVAILABLE STOCK + RM TYPE (ALL BOM TYPES) ===\n");

  const items = await prisma.enquiryItem.findMany({
    where: {
      rmItemCode: { not: null },
    },
    select: {
      id: true,
      rmItemCode: true,
      availableStock: true,
      rmType: true,
      erpItemCode: true,
    },
  });

  console.log(`Found ${items.length} EnquiryItems with rmItemCode != null (any BOM type).`);

  const rmCodes = items.map((i) => i.rmItemCode).filter(Boolean) as string[];
  const stockMap = await getRmStockMap(rmCodes);
  const rmTypeMap = await getRmTypeMap(rmCodes);

  console.log(`Matched ${stockMap.size} distinct RM codes with valid, non-empty available stock in GMDUpdateItem.`);
  console.log(`Matched ${rmTypeMap.size} distinct RM codes with valid, non-empty RM TYPE in GMDUpdateItem.`);

  let updatedCount = 0;
  let alreadyUpToDate = 0;
  let noValueFound = 0;

  for (const item of items) {
    if (!item.rmItemCode) continue;
    const stock = stockMap.get(item.rmItemCode);
    const rmType = rmTypeMap.get(item.rmItemCode);

    const data: { availableStock?: string; rmType?: string } = {};
    if (stock !== undefined && item.availableStock !== stock) data.availableStock = stock;
    if (rmType !== undefined && item.rmType !== rmType) data.rmType = rmType;

    if (Object.keys(data).length === 0) {
      if (stock === undefined && rmType === undefined) noValueFound++;
      else alreadyUpToDate++;
      continue;
    }

    await prisma.enquiryItem.update({
      where: { id: item.id },
      data,
    });
    updatedCount++;
  }

  console.log("\n=== BACKFILL SUMMARY ===");
  console.log(`Items updated with stock/rmType:    ${updatedCount}`);
  console.log(`Items already matching:             ${alreadyUpToDate}`);
  console.log(`Items with no value / skipped:      ${noValueFound}`);
  console.log(`Total items evaluated:              ${items.length}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
