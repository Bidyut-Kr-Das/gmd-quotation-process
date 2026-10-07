import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BLANK_VALUES = new Set(["", null, undefined, "-"]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating blank extensions..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      extension: true,
      itemType: true,
      moc: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const blankItems = allItems.filter(
    (item) => BLANK_VALUES.has(item.extension)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with blank extension: ${blankItems.length}\n`);

  let foundCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const detected: { docket: string; ext: string; itemName: string }[] = [];

  for (let i = 0; i < blankItems.length; i++) {
    const item = blankItems[i];
    process.stdout.write(
      `\r[${i + 1}/${blankItems.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const resolved = await resolveItemCategory({
      itemName: item.itemName,
      sheetItemType: item.itemType,
      sheetMoc: item.moc,
    });

    if (!resolved.extension) {
      skippedCount++;
      continue;
    }

    foundCount++;
    detected.push({ docket: item.enquiry.docketNumber, ext: resolved.extension, itemName: item.itemName });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { extension: resolved.extension },
      });
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total blank items: ${blankItems.length}`);
  console.log(`Extension detected: ${foundCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);

  if (detected.length > 0) {
    console.log("\nDetected extensions (first 30):");
    for (const d of detected.slice(0, 30)) {
      console.log(`  ${d.docket} → ${d.ext} | ${d.itemName.substring(0, 60)}`);
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
