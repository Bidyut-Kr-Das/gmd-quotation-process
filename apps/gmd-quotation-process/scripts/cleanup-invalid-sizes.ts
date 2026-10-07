import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { allowedSizes } from "../lib/sizeExtractor";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function isValidSize(val: string | null | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  return allowedSizes.includes(trimmed);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Cleaning up invalid sizes..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      size: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const invalidItems = allItems.filter(
    (item) => item.size !== null && item.size !== undefined && !isValidSize(item.size)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with invalid sizes: ${invalidItems.length}\n`);

  if (invalidItems.length > 0) {
    console.log("Invalid sizes to clean:");
    for (const item of invalidItems) {
      console.log(`  ${item.enquiry.docketNumber} | size="${item.size}" | ${item.itemName.substring(0, 60)}`);
    }
    console.log();
  }

  let cleanedCount = 0;
  for (let i = 0; i < invalidItems.length; i++) {
    const item = invalidItems[i];
    process.stdout.write(
      `\r[${i + 1}/${invalidItems.length}] ${item.enquiry.docketNumber}`
    );

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { size: null },
      });
      cleanedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Invalid items found: ${invalidItems.length}`);
  console.log(`Cleaned: ${cleanedCount}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
