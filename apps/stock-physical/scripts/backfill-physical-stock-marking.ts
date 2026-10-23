import "dotenv/config";
import { stockPrisma } from "@gmd/db-stock";
import { computeMajorMinorMarking } from "@gmd/physical-stock/columns";

/**
 * One-time backfill: set `PhysicalStock.majorminor_marking` from
 * `l8_item_category` (major = true, minor = false).
 *
 *   npm run marking          # dry run
 *   npm run marking:apply    # write
 *
 * Only rows whose `majorminor_marking` is NULL are written: an existing
 * true/false is never overwritten (the apply step repeats the null check in
 * its WHERE clause, so a value set between the dry run and the apply survives).
 *
 * The category -> marking rules live in `computeMajorMinorMarking`
 * (@gmd/physical-stock/columns) and are the same ones used when a new item is
 * created. Any category that returns null, including a blank one, is reported
 * and skipped.
 */

const apply = process.argv.includes("--apply");

const norm = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

async function main() {
  console.log(
    `\n=== Physical Stock major/minor marking ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`,
  );

  const rows = await stockPrisma.physicalStock.findMany({
    select: { id: true, erp_code: true, l8_item_category: true, majorminor_marking: true },
  });

  const blank = rows.filter((r) => r.majorminor_marking === null);
  const toMajor: { id: string; category: string }[] = [];
  const toMinor: { id: string; category: string }[] = [];
  const unknown = new Map<string, number>();
  const counts = new Map<string, { major: number; minor: number }>();
  const bump = (category: string, major: boolean) => {
    const entry = counts.get(category) ?? { major: 0, minor: 0 };
    if (major) entry.major++;
    else entry.minor++;
    counts.set(category, entry);
  };

  for (const row of blank) {
    const category = norm(row.l8_item_category);
    const marking = computeMajorMinorMarking(row.l8_item_category);
    if (marking === true) {
      toMajor.push({ id: row.id, category });
      bump(category, true);
    } else if (marking === false) {
      toMinor.push({ id: row.id, category });
      bump(category, false);
    } else {
      unknown.set(category || "(blank)", (unknown.get(category || "(blank)") ?? 0) + 1);
    }
  }

  const toUpdate = [...toMajor, ...toMinor];
  const unknownRows = [...unknown.values()].reduce((a, b) => a + b, 0);

  console.log(`PhysicalStock rows       : ${rows.length}`);
  console.log(`  marking already set    : ${rows.length - blank.length}`);
  console.log(`  marking null           : ${blank.length}`);
  console.log(`  -> major (true)        : ${toMajor.length}`);
  console.log(`  -> minor (false)       : ${toMinor.length}`);
  console.log(`  unmatched (skipped)    : ${unknownRows}`);
  if (unknown.size > 0) console.log(`  unmatched categories   : ${[...unknown.keys()].join(", ")}`);

  console.log(`\n--- Updates by category ---`);
  console.table(
    [...counts.entries()]
      .sort((a, b) => b[1].major + b[1].minor - (a[1].major + a[1].minor))
      .map(([category, c]) => ({ category, major: c.major, minor: c.minor })),
  );

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    return;
  }

  const groups: { marking: boolean; ids: string[] }[] = [
    { marking: true, ids: toMajor.map((r) => r.id) },
    { marking: false, ids: toMinor.map((r) => r.id) },
  ];

  let updated = 0;
  for (const group of groups) {
    if (group.ids.length === 0) continue;
    const result = await stockPrisma.physicalStock.updateMany({
      where: { id: { in: group.ids }, majorminor_marking: null },
      data: { majorminor_marking: group.marking },
    });
    updated += result.count;
    console.log(`  ...${group.marking ? "major" : "minor"} updated ${result.count}/${group.ids.length}`);
  }

  console.log(`\nApplied: updated=${updated} (skipped ${toUpdate.length - updated} already set)\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stockPrisma.$disconnect();
  });
