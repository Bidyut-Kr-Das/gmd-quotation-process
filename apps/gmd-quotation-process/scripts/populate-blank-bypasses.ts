import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { detectBypass } from "../lib/bypassDetector";
import { hasBypassMention } from "../lib/bypassMatcher";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BLANK_VALUES = new Set(["", null, undefined, "-"]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating blank bypasses..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      size: true,
      bypass: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const blankItems = allItems.filter(
    (item) => BLANK_VALUES.has(item.bypass)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with blank bypass: ${blankItems.length}\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  const detected: { docket: string; size: string | null; bypass: string; itemName: string }[] = [];

  for (let i = 0; i < blankItems.length; i++) {
    const item = blankItems[i];
    process.stdout.write(
      `\r[${i + 1}/${blankItems.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    if (!hasBypassMention(item.itemName)) {
      skippedCount++;
      continue;
    }

    const bypass = detectBypass(item.size);

    if (bypass === "-") {
      skippedCount++;
      continue;
    }

    detected.push({ docket: item.enquiry.docketNumber, size: item.size, bypass, itemName: item.itemName });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { bypass },
      });
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total blank items: ${blankItems.length}`);
  console.log(`Bypass detected: ${updatedCount}`);
  console.log(`Skipped (size < 100 or no size): ${skippedCount}`);

  if (detected.length > 0) {
    console.log("\nDetected bypasses (first 30):");
    for (const d of detected.slice(0, 30)) {
      console.log(`  ${d.docket} | size=${d.size || "?"} → bypass=${d.bypass} | ${d.itemName.substring(0, 50)}`);
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
