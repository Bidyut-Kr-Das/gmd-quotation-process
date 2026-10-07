import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SIZE_NOT_FOUND = "Not detectable";
const BLANK_VALUES = new Set([
  "",
  "-",
  "Not detectable",
  "Not mentioned/cant detect size",
]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating blank sizes..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      size: true,
      itemType: true,
      moc: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const blankItems = allItems.filter(
    (item) =>
      !item.size ||
      item.size === null ||
      BLANK_VALUES.has(item.size)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with blank size: ${blankItems.length}\n`);

  let foundCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const detected: { docket: string; size: string; itemName: string }[] = [];

  for (let i = 0; i < blankItems.length; i++) {
    const item = blankItems[i];
    process.stdout.write(
      `\r[${i + 1}/${blankItems.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const resolved = await resolveItemCategory({
      itemName: item.itemName,
      sheetItemType: item.itemType,
      sheetMoc: item.moc,
      sheetSize: null,
    });

    const detectedSize = resolved.size;

    if (!detectedSize || detectedSize === SIZE_NOT_FOUND) {
      skippedCount++;
      continue;
    }

    foundCount++;
    detected.push({ docket: item.enquiry.docketNumber, size: detectedSize, itemName: item.itemName });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { size: detectedSize },
      });
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total blank items: ${blankItems.length}`);
  console.log(`Size detected: ${foundCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (no size detectable): ${skippedCount}`);

  if (detected.length > 0) {
    console.log("\nDetected sizes (first 20):");
    for (const d of detected.slice(0, 20)) {
      console.log(`  ${d.docket} → ${d.size} | ${d.itemName.substring(0, 60)}`);
    }
    if (detected.length > 20) {
      console.log(`  ... and ${detected.length - 20} more`);
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
