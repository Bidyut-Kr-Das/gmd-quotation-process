import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { matchMoc } from "../lib/itemTypePatterns";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Fixing misclassified MOCs..."
  );

  const items = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      moc: true,
      mocSource: true,
      enquiry: { select: { docketNumber: true } },
    },
    where: { moc: "CAST STEEL/CARBON STEEL" },
  });

  console.log(`Total items with MOC = CAST STEEL/CARBON STEEL: ${items.length}\n`);

  let fixedCount = 0;
  let skippedCount = 0;
  const fixed: { docket: string; oldMoc: string; newMoc: string; itemName: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(
      `\r[${i + 1}/${items.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    const keywordMoc = matchMoc(item.itemName);

    if (!keywordMoc || keywordMoc === item.moc) {
      skippedCount++;
      continue;
    }

    fixedCount++;
    fixed.push({
      docket: item.enquiry.docketNumber,
      oldMoc: item.moc || "",
      newMoc: keywordMoc || "",
      itemName: item.itemName,
    });

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { moc: keywordMoc, mocSource: 'keyword' },
      });
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total checked: ${items.length}`);
  console.log(`Fixed: ${fixedCount}`);
  console.log(`Skipped: ${skippedCount}`);

  if (fixed.length > 0) {
    console.log("\nFixes applied:");
    for (const f of fixed) {
      console.log(`  ${f.docket}`);
      console.log(`    "${f.oldMoc}" → "${f.newMoc}"`);
      console.log(`    ${f.itemName.substring(0, 80)}`);
      console.log();
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
