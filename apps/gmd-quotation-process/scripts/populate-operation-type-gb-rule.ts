import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SLUICE_BFV_PATTERN = /sluice|butterfly\s*valve/i;

function extractSizeFromName(name: string): number | null {
  const patterns = [
    /DN(\d+)/i,
    /(\d+)\s*NB/i,
    /(\d+)\s*MM/i,
    /(\d+)"(?:\s*|$)/,
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m) {
      let val = parseInt(m[1], 10);
      if (m[0].includes('"')) val = Math.round(val * 25.4);
      return val;
    }
  }
  const bare = name.match(/\b(\d{3,4})\b/);
  if (bare) {
    const val = parseInt(bare[1], 10);
    if (!isNaN(val)) return val;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun
      ? "DRY RUN — no changes will be made"
      : "Applying GB rule for sluice/butterfly valves > 350mm..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      itemType: true,
      size: true,
      operationType: true,
      enquiry: { select: { docketNumber: true } },
    },
  });

  const candidates = allItems.filter((item) => {
    const hasValve =
      (item.itemType && /SLUICE|BUTTERFLY/.test(item.itemType)) ||
      SLUICE_BFV_PATTERN.test(item.itemName || "");
    if (!hasValve) return false;

    const sizeStr = item.size || "";
    const sizeNum =
      parseInt(sizeStr, 10) || extractSizeFromName(item.itemName || "");

    return sizeNum !== null && !isNaN(sizeNum) && sizeNum > 350;
  });

  console.log(`Total items: ${allItems.length}`);
  console.log(`Candidates (sluice/bfv > 350mm): ${candidates.length}\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    process.stdout.write(
      `\r[${i + 1}/${candidates.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`
    );

    if (item.operationType === "GB") {
      skippedCount++;
      continue;
    }

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { operationType: "GB" },
      });
      updatedCount++;
    } else {
      updatedCount++;
    }

    const sizeStr = item.size || extractSizeFromName(item.itemName || "") || "?";
    console.log(
      `\n  ${item.itemName.substring(0, 60).padEnd(60)} size=${sizeStr} opType="${item.operationType || ""}" → "GB"`
    );
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Candidates found: ${candidates.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (already GB): ${skippedCount}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
