import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SIZE_BLANK_VALUES = new Set([
  "",
  "-",
  "Not detectable",
  "Not mentioned/cant detect size",
]);

const EXT_BLANK_VALUES = new Set(["", null, undefined, "-"]);
const BYPASS_BLANK_VALUES = new Set(["", null, undefined, "-"]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating all blank fields..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      itemType: true,
      itemTypeSource: true,
      moc: true,
      mocSource: true,
      size: true,
      pnRating: true,
      operationType: true,
      extension: true,
      bypass: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const total = allItems.length;
  let updatedCount = 0;
  let skippedCount = 0;
  const fieldCounts = { itemType: 0, moc: 0, size: 0, pnRating: 0, operationType: 0, extension: 0, bypass: 0 };

  for (let i = 0; i < total; i++) {
    const item = allItems[i];
    process.stdout.write(
      `\r[${i + 1}/${total}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const resolved = await resolveItemCategory({
      itemName: item.itemName,
      sheetItemType: item.itemTypeSource === "sheet" ? item.itemType : undefined,
      sheetMoc: item.mocSource === "sheet" ? item.moc : undefined,
    });

    const updates: Record<string, string | null> = {};

    if (!item.itemType && resolved.itemType) {
      updates.itemType = resolved.itemType;
      updates.itemTypeSource = resolved.itemTypeSource || null;
    }
    if (!item.moc && resolved.moc) {
      updates.moc = resolved.moc;
      updates.mocSource = resolved.mocSource || null;
    }
    if (
      (!item.size || SIZE_BLANK_VALUES.has(item.size)) &&
      resolved.size &&
      !SIZE_BLANK_VALUES.has(resolved.size)
    ) {
      updates.size = resolved.size;
    }
    if (!item.pnRating && resolved.pnRating) {
      updates.pnRating = resolved.pnRating;
    }
    if (!item.operationType && resolved.operationType) {
      updates.operationType = resolved.operationType;
    }
    if (EXT_BLANK_VALUES.has(item.extension) && resolved.extension) {
      updates.extension = resolved.extension;
    }
    if (BYPASS_BLANK_VALUES.has(item.bypass) && resolved.bypass && resolved.bypass !== "-") {
      updates.bypass = resolved.bypass;
    }

    if (Object.keys(updates).length === 0) {
      skippedCount++;
      continue;
    }

    for (const key of Object.keys(updates)) {
      if (key in fieldCounts) (fieldCounts as any)[key]++;
    }

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: updates,
      });
      updatedCount++;
    } else {
      updatedCount++;
    }

    const changes: string[] = [];
    if (updates.itemType) changes.push(`type:${updates.itemType}`);
    if (updates.moc) changes.push(`moc:${updates.moc}`);
    if (updates.size) changes.push(`size:${updates.size}`);
    if (updates.pnRating) changes.push(`pn:${updates.pnRating}`);
    if (updates.operationType) changes.push(`op:${updates.operationType}`);
    if (updates.extension) changes.push(`ext:${updates.extension}`);
    if (updates.bypass) changes.push(`bp:${updates.bypass}`);
    console.log(`\n  ${item.itemName.substring(0, 60).padEnd(60)} ${changes.join(", ")}`);
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total items: ${total}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (no changes): ${skippedCount}`);
  console.log(`\nField breakdown:`);
  console.log(`  itemType:    ${fieldCounts.itemType}`);
  console.log(`  moc:         ${fieldCounts.moc}`);
  console.log(`  size:        ${fieldCounts.size}`);
  console.log(`  pnRating:    ${fieldCounts.pnRating}`);
  console.log(`  operationType: ${fieldCounts.operationType}`);
  console.log(`  extension:   ${fieldCounts.extension}`);
  console.log(`  bypass:      ${fieldCounts.bypass}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
