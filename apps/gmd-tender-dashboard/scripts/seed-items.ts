import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../lib/prisma";

type ItemMapEntry = {
  itemCode: string;
  itemScheduleName: string;
  itemName: string | null;
};

async function main() {
  const filePath = resolve(process.cwd(), "docs/itemmap.json");
  const raw = readFileSync(filePath, "utf8");
  const entries: ItemMapEntry[] = JSON.parse(raw);

  console.log(`Loaded ${entries.length} entries from ${filePath}`);

  const byCode = new Map<string, Omit<ItemMapEntry, "itemName"> & { itemName: string }>();
  for (const entry of entries) {
    if (!entry.itemName) {
      console.warn(`⚠️ Skipping entry with null/empty itemName: ${entry.itemCode}`);
      continue;
    }
    byCode.set(entry.itemCode, entry as Omit<ItemMapEntry, "itemName"> & { itemName: string });
  }

  console.log(`Seeding ${byCode.size} unique items...`);

  let created = 0;
  let updated = 0;
  const failed: { itemCode: string; error: string }[] = [];

  for (const entry of byCode.values()) {
    try {
      await prisma.items.upsert({
        where: { itemcode: entry.itemCode },
        update: {
          itemName: entry.itemName,
          itemSchedule: entry.itemScheduleName,
        },
        create: {
          itemcode: entry.itemCode,
          itemName: entry.itemName,
          itemSchedule: entry.itemScheduleName,
        },
      });
      created++;
      console.log(`✅ ${entry.itemCode} — ${entry.itemName}`);
    } catch (err) {
      failed.push({
        itemCode: entry.itemCode,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`❌ ${entry.itemCode} — ${entry.itemName}`);
    }
  }

  console.log(
    `Done. ${created} upserted (${updated} updated), ${failed.length} failed.`,
  );
  if (failed.length) {
    console.error("Failed items:");
    for (const f of failed) {
      console.error(`  ❌ ${f.itemCode}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
