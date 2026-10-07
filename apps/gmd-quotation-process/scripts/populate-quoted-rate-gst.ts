import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { roundUp } from "../lib/rounding";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun
      ? "DRY RUN — no changes will be made"
      : "Populating quotedRateGst for all items..."
  );

  const items = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      quotedRate: true,
      quotedRateGst: true,
    },
  });

  console.log(`Found ${items.length} items.\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(
      `\r[${i + 1}/${items.length}] ${item.itemName
        .substring(0, 50)
        .padEnd(50)}`
    );

    try {
      if (!item.quotedRate) {
        skippedCount++;
        continue;
      }

      const qr = parseFloat(item.quotedRate);
      if (isNaN(qr) || qr <= 0) {
        skippedCount++;
        continue;
      }

      const roundedQr = roundUp(qr);
      const gst = (roundedQr * 1.18).toFixed(2);

      if (!isDryRun) {
        await prisma.enquiryItem.update({
          where: { id: item.id },
          data: {
            quotedRate: roundedQr.toFixed(2),
            quotedRateGst: gst,
          },
        });
      }

      updatedCount++;
    } catch (err) {
      console.error(`\n[ERROR] Item ${item.id}: ${(err as Error).message}`);
      errorCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total items: ${items.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
