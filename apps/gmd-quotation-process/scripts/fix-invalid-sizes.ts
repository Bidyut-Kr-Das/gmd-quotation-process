import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { extractSizeFromItemName, allowedSizes } from "../lib/sizeExtractor";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Fixing invalid sizes..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      size: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const badItems = allItems.filter(
    (item) => item.size && !allowedSizes.includes(item.size)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with invalid sizes: ${badItems.length}\n`);

  let fixed = 0;
  let skipped = 0;

  for (let i = 0; i < badItems.length; i++) {
    const item = badItems[i];
    process.stdout.write(
      `\r[${i + 1}/${badItems.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const corrected = extractSizeFromItemName(item.itemName);

    if (!corrected || corrected === item.size) {
      skipped++;
      continue;
    }

    console.log(`\n  ${item.size} → ${corrected} | ${item.itemName.substring(0, 60)}`);

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { size: corrected },
      });
      fixed++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Invalid items: ${badItems.length}`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Skipped (no correction found): ${skipped}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
