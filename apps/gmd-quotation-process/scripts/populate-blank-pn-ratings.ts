import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { matchPnRating } from "../lib/pnRatingMatcher";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Populating blank PN ratings..."
  );

  const items = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      pnRating: true,
      enquiry: { select: { docketNumber: true } },
    },
    where: {
      OR: [
        { pnRating: null },
        { pnRating: "" },
        { pnRating: "-" },
      ],
    },
  });

  console.log(`Total items with blank PN rating: ${items.length}\n`);

  let foundCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const detected: { docket: string; rating: string; itemName: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(
      `\r[${i + 1}/${items.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const rating = matchPnRating(item.itemName);

    if (!rating) {
      skippedCount++;
      continue;
    }

    foundCount++;
    detected.push({ docket: item.enquiry.docketNumber, rating, itemName: item.itemName });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { pnRating: rating },
      });
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total blank items: ${items.length}`);
  console.log(`Detected: ${foundCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (no PN rating in name): ${skippedCount}`);

  if (detected.length > 0) {
    console.log("\nDetected PN ratings (first 20):");
    for (const d of detected.slice(0, 20)) {
      console.log(`  ${d.docket} → ${d.rating} | ${d.itemName.substring(0, 60)}`);
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
