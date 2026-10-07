import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");
const TYPE = "DELIVERY";

// Canonical Delivery Schedule lookup values (single source of truth).
const DESIRED_LOOKUPS = [
  "-",
  "2-3 weeks",
  "2 months",
  "3 months",
  "Min. 3 to 4 months",
  "Ready Stock",
  "Within 2 months",
  "30 Days FRom the Date of MFC",
];

// Item values that must be rewritten to a canonical lookup value.
const ALIASES: Record<string, string> = {
  "3-4 months": "Min. 3 to 4 months",
};

function show(value: string): string {
  return value === "" ? "<blank>" : value;
}

async function main() {
  console.log(`\n=== SYNC DELIVERY SCHEDULE LOOKUP [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  const existing = await prisma.lookupOption.findMany({ where: { type: TYPE } });
  const existingSet = new Set(existing.map((o) => o.value.trim()));
  const canonicalByLower = new Map(existing.map((o) => [o.value.trim().toLowerCase(), o.value.trim()]));
  // Desired values are canonical too, so a manual item value matching one of them
  // (e.g. "2 months") is accepted rather than reported as unknown.
  for (const v of DESIRED_LOOKUPS) {
    const key = v.toLowerCase();
    if (!canonicalByLower.has(key)) canonicalByLower.set(key, v);
  }

  // 1. Lookup options to create
  const lookupsToAdd = DESIRED_LOOKUPS.filter((v) => !existingSet.has(v));

  // 2. Group current item values
  const items = await prisma.enquiryItem.findMany({
    select: { id: true, deliverySchedule: true },
  });
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const v = (it.deliverySchedule ?? "").trim();
    if (!v) continue;
    const ids = groups.get(v) ?? [];
    ids.push(it.id);
    groups.set(v, ids);
  }

  // 3. Resolve each distinct item value -> canonical / new lookup
  const renames: { from: string; to: string; ids: string[] }[] = [];
  const unknownValues: string[] = [];
  for (const [value, ids] of groups) {
    const lower = value.toLowerCase();
    let target: string | null = null;
    if (ALIASES[lower]) target = ALIASES[lower];
    else if (canonicalByLower.has(lower)) target = canonicalByLower.get(lower)!;
    else if (existingSet.has(value)) target = value;

    if (target && target !== value) {
      renames.push({ from: value, to: target, ids });
    } else if (!target) {
      unknownValues.push(value);
    }
  }

  console.log(`--- LOOKUP OPTIONS TO ADD (${lookupsToAdd.length}) ---`);
  for (const v of lookupsToAdd) console.log(`  + "${v}"`);

  console.log(`\n--- ITEM ROWS TO NORMALIZE (${renames.length} value groups) ---`);
  for (const r of renames) {
    console.log(`  "${show(r.from)}" -> "${show(r.to)}"  (${r.ids.length} row${r.ids.length === 1 ? "" : "s"})`);
  }

  console.log(`\n--- ITEM VALUES NOT IN LOOKUP (${unknownValues.length}) ---`);
  for (const v of unknownValues) {
    console.log(`  "${show(v)}" -> will be added as a new lookup option (${groups.get(v)!.length} row(s))`);
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Lookup options to add:   ${lookupsToAdd.length + unknownValues.length}`);
  console.log(`Item value groups to fix: ${renames.length}`);
  console.log(`Item rows to update:      ${renames.reduce((n, r) => n + r.ids.length, 0)}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write changes.\n");
    return;
  }

  // Apply: add lookups
  let sortOrder = existing.length;
  for (const value of [...lookupsToAdd, ...unknownValues]) {
    await prisma.lookupOption.upsert({
      where: { type_value: { type: TYPE, value } },
      update: { isActive: true },
      create: { type: TYPE, value, sortOrder: sortOrder++ },
    });
  }

  // Apply: normalize item rows
  let updated = 0;
  for (const r of renames) {
    const res = await prisma.enquiryItem.updateMany({
      where: { id: { in: r.ids } },
      data: { deliverySchedule: r.to },
    });
    updated += res.count;
  }

  console.log(`\nApplied. Added ${lookupsToAdd.length + unknownValues.length} lookup option(s); updated ${updated} item row(s).\n`);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
