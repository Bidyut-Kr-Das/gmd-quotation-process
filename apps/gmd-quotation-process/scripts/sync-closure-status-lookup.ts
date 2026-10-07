import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");
const TYPE = "CLOSURE_STATUS";

// Canonical Closure Status lookup values (single source of truth).
const DESIRED_LOOKUPS = ["Sent", "Rejected", "Pending"];

// Item values to rewrite to a canonical value.
const ALIASES: Record<string, string> = {
  "not to be sent": "Rejected",
};

// Values to clear (set to null).
const CLEAR_VALUES = new Set(["po isue"]);

function show(value: string | null): string {
  if (value === null) return "<cleared>";
  return value === "" ? "<blank>" : value;
}

async function main() {
  console.log(`\n=== SYNC CLOSURE STATUS LOOKUP [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  const existing = await prisma.lookupOption.findMany({ where: { type: TYPE } });
  const existingSet = new Set(existing.map((o) => o.value.trim()));
  const canonicalByLower = new Map(existing.map((o) => [o.value.trim().toLowerCase(), o.value.trim()]));
  for (const v of DESIRED_LOOKUPS) {
    const key = v.toLowerCase();
    if (!canonicalByLower.has(key)) canonicalByLower.set(key, v);
  }

  const lookupsToAdd = DESIRED_LOOKUPS.filter((v) => !existingSet.has(v));

  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, closureStatus: true },
  });
  const groups = new Map<string, string[]>();
  for (const e of enquiries) {
    const v = (e.closureStatus ?? "").trim();
    if (!v) continue;
    const ids = groups.get(v) ?? [];
    ids.push(e.id);
    groups.set(v, ids);
  }

  const updates: { from: string; to: string | null; ids: string[] }[] = [];
  const unknownValues: string[] = [];
  for (const [value, ids] of groups) {
    const lower = value.toLowerCase();
    let target: string | null | undefined;
    if (CLEAR_VALUES.has(lower)) target = null;
    else if (ALIASES[lower]) target = ALIASES[lower];
    else if (canonicalByLower.has(lower)) target = canonicalByLower.get(lower)!;
    else target = undefined;

    if (target === undefined) {
      unknownValues.push(value);
      continue;
    }
    if (target !== value) {
      updates.push({ from: value, to: target, ids });
    }
  }

  console.log(`--- LOOKUP OPTIONS TO ADD (${lookupsToAdd.length}) ---`);
  for (const v of lookupsToAdd) console.log(`  + "${v}"`);

  console.log(`\n--- ENQUIRY ROWS TO NORMALIZE (${updates.length} value groups) ---`);
  for (const r of updates) {
    console.log(`  "${show(r.from)}" -> "${show(r.to)}"  (${r.ids.length} row${r.ids.length === 1 ? "" : "s"})`);
  }

  console.log(`\n--- VALUES NOT IN LOOKUP (${unknownValues.length}) ---`);
  for (const v of unknownValues) {
    console.log(`  "${show(v)}" -> will be added as a new lookup option (${groups.get(v)!.length} row(s))`);
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Lookup options to add:   ${lookupsToAdd.length + unknownValues.length}`);
  console.log(`Value groups to fix:     ${updates.length}`);
  console.log(`Enquiry rows to update:  ${updates.reduce((n, r) => n + r.ids.length, 0)}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write changes.\n");
    return;
  }

  let sortOrder = existing.length;
  for (const value of [...lookupsToAdd, ...unknownValues]) {
    await prisma.lookupOption.upsert({
      where: { type_value: { type: TYPE, value } },
      update: { isActive: true },
      create: { type: TYPE, value, sortOrder: sortOrder++ },
    });
  }

  let updated = 0;
  for (const r of updates) {
    const res = await prisma.enquiry.updateMany({
      where: { id: { in: r.ids } },
      data: { closureStatus: r.to },
    });
    updated += res.count;
  }

  console.log(`\nApplied. Added ${lookupsToAdd.length + unknownValues.length} lookup option(s); updated ${updated} enquiry row(s).\n`);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
