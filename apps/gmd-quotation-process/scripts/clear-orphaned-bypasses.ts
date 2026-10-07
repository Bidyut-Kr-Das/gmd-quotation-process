import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { hasBypassMention } from "../lib/bypassMatcher";
import { recalculateItem } from "../lib/costCalculator";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BLANK_VALUES = new Set(["", null, undefined, "-"]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Clearing orphaned bypasses (bypass != '-' but itemName has no mention)..."
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

  // Orphaned: bypass is set but itemName does NOT mention bypass/by-pass/by pass
  const orphaned = allItems.filter(
    (item) => !BLANK_VALUES.has(item.bypass as any) && !hasBypassMention(item.itemName)
  );

  console.log(`Total items: ${allItems.length}`);
  console.log(`Items with bypass != "-": ${allItems.filter((i) => !BLANK_VALUES.has(i.bypass as any)).length}`);
  console.log(`Orphaned (will be cleared): ${orphaned.length}\n`);

  // Histogram by bypass value
  const hist = new Map<string, number>();
  for (const o of orphaned) {
    const key = o.bypass || "null";
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  if (hist.size > 0) {
    console.log("Histogram (orphaned bypass values):");
    for (const [bypass, count] of Array.from(hist.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${bypass}: ${count}`);
    }
    console.log("");
  }

  let updatedCount = 0;

  for (let i = 0; i < orphaned.length; i++) {
    const item = orphaned[i];
    process.stdout.write(
      `\r[${i + 1}/${orphaned.length}] ${item.enquiry.docketNumber} | size=${String(item.size || "?").padEnd(6)} bypass=${String(item.bypass || "?").padEnd(4)} → "-" | ${item.itemName.substring(0, 55).padEnd(55)}`
    );

    if (!isDryRun) {
      // Update bypass to "-" and recalculate cost to drop flat bypass cost
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { bypass: "-" },
      });
      try {
        await recalculateItem(item.id, { bypass: "-" });
      } catch (e) {
        console.warn(`\n  warn recalc failed for ${item.id}:`, e);
      }
      updatedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total items: ${allItems.length}`);
  console.log(`Orphaned bypasses: ${orphaned.length}`);
  if (isDryRun) {
    console.log(`Would be cleared: ${orphaned.length}`);
  } else {
    console.log(`Cleared: ${updatedCount}`);
  }

  if (orphaned.length > 0) {
    console.log("\nOrphaned bypasses (first 30):");
    for (const d of orphaned.slice(0, 30)) {
      console.log(`  ${d.enquiry.docketNumber} | size=${String(d.size || "?").padEnd(6)} bypass=${String(d.bypass || "?").padEnd(4)} → "-" | ${d.itemName.substring(0, 60)}`);
    }
    if (orphaned.length > 30) {
      console.log(`  ... and ${orphaned.length - 30} more`);
    }
  }

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes (sets bypass to \"-\" and recalculates cost).");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
