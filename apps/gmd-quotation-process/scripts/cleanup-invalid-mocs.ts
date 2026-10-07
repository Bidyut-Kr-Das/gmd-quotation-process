import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const VALID_MOCS = new Set([
  "DUCTILE IRON/CAST IRON",
  "MILD STEEL",
  "CAST STEEL/CARBON STEEL",
  "ACTUATOR",
  "RUBBER",
  "OTHERS",
  "CAPEX",
  "STAINLESS STEEL",
  "GUN METAL/ BRASS",
  "LEATHER",
  "FORGED STEEL",
  "MONEL STEEL",
  "WOODEN",
  "GALVANISED",
]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Cleaning up invalid MOCs..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      moc: true,
      mocSource: true,
      enquiry: { select: { docketNumber: true } },
    },
    where: { moc: { not: null } },
  });

  const invalidItems = allItems.filter(
    (item) => item.moc && !VALID_MOCS.has(item.moc)
  );

  console.log(`Total items with MOC: ${allItems.length}`);
  console.log(`Items with invalid MOC: ${invalidItems.length}\n`);

  if (invalidItems.length > 0) {
    console.log("Invalid MOCs to clean:");
    for (const item of invalidItems) {
      console.log(`  ${item.enquiry.docketNumber} | "${item.moc}" | source=${item.mocSource} | ${item.itemName.substring(0, 50)}`);
    }
    console.log();
  }

  let cleanedCount = 0;
  for (let i = 0; i < invalidItems.length; i++) {
    const item = invalidItems[i];
    process.stdout.write(`\r[${i + 1}/${invalidItems.length}] ${item.enquiry.docketNumber}`);

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { moc: null, mocSource: null },
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

  if (!isDryRun && invalidItems.length > 0) {
    console.log("\nRun the validation script to re-classify cleaned items:");
    console.log("  npx tsx scripts/validate-existing-items.ts --apply");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
