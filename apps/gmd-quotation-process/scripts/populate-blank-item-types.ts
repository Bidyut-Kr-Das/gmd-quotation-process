import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating blank item types..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      itemType: true,
      itemTypeSource: true,
      moc: true,
      size: true,
      operationType: true,
      enquiry: { select: { docketNumber: true } },
    },
    where: { itemType: null },
  });

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with null itemType: ${allItems.length}\n`);

  let foundCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const detected: { docket: string; type: string; itemName: string }[] = [];

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    process.stdout.write(
      `\r[${i + 1}/${allItems.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const resolved = await resolveItemCategory({
      itemName: item.itemName,
      sheetItemType: item.itemType,
      sheetMoc: item.moc,
    });

    if (!resolved.itemType) {
      skippedCount++;
      continue;
    }

    foundCount++;
    detected.push({ docket: item.enquiry.docketNumber, type: resolved.itemType, itemName: item.itemName });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          itemType: resolved.itemType,
          itemTypeSource: resolved.itemTypeSource,
          moc: resolved.moc || item.moc,
          mocSource: resolved.mocSource || null,
          operationType: resolved.operationType,
        },
      });
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total items with null itemType: ${allItems.length}`);
  console.log(`Detected: ${foundCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (not detectable): ${skippedCount}`);

  if (detected.length > 0) {
    console.log("\nDetected item types (first 30):");
    for (const d of detected.slice(0, 30)) {
      console.log(`  ${d.docket} → ${d.type} | ${d.itemName.substring(0, 60)}`);
    }
    if (detected.length > 30) {
      console.log(`  ... and ${detected.length - 30} more`);
    }
  }

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
