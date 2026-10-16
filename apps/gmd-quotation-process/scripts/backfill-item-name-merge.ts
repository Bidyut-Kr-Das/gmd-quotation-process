import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getItemNameMerge } from "@/lib/costCalculator";

/**
 * One-time backfill: recompute EnquiryItem.itemNameMerge so it carries the
 * labelled suffixes: "...-WITH-EXTENSION-<ext>", "...-WITH-BYPASS-<bypass>"
 * and "...-WITH-<others>" (e.g. flange, gasket) whenever those values are set.
 * Only rows whose computed merge differs from the stored value are touched,
 * so it is idempotent.
 * Usage:
 *   npx tsx scripts/backfill-item-name-merge.ts           // dry-run (no writes)
 *   npx tsx scripts/backfill-item-name-merge.ts --apply   // writes
 */

type Row = {
  id: string;
  itemName: string | null;
  others: string[];
  itemNameMerge: string | null;
  itemType: string | null;
  moc: string | null;
  size: string | null;
  pnRating: string | null;
  operationType: string | null;
  extension: string | null;
  bypass: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Backfill ItemNameMerge (extension / bypass / Other suffixes) — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n`);

  const items = (await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      others: true,
      itemNameMerge: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
      extension: true,
      bypass: true,
    },
  })) as unknown as Row[];

  const toUpdate: { row: Row; cur: string | null; next: string | null }[] = [];

  for (const row of items) {
    const next = getItemNameMerge(row) || null;
    const cur = row.itemNameMerge || null;
    if (cur === next) continue;
    toUpdate.push({ row, cur, next });
  }

  const hasValue = (v: string | null | undefined) => !!(v && v.trim());
  const withSuffixes = items.filter(
    (r) =>
      (r.others && r.others.length > 0) ||
      hasValue(r.extension) ||
      hasValue(r.bypass),
  ).length;
  console.log(`Total items:                 ${items.length}`);
  console.log(`Items with suffix values:    ${withSuffixes}`);
  console.log(`Need update (merge changed): ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log("No items to update. Exiting.\n");
    return;
  }

  const sample = toUpdate.slice(0, 20);
  console.table(
    sample.map((u) => ({
      id: u.row.id.substring(0, 8) + "...",
      itemName: (u.row.itemName ?? "").substring(0, 40),
      others: u.row.others.join(", "),
      "old merge": u.cur ?? "-",
      "new merge": u.next ?? "-",
    }))
  );
  if (toUpdate.length > 20) {
    console.log(`... and ${toUpdate.length - 20} more (not shown)\n`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. Run with --apply to write to DB.\n");
    console.log("Example: npx tsx scripts/backfill-item-name-merge.ts --apply\n");
    return;
  }

  console.log("\nApplying updates...\n");
  let updated = 0;
  for (const u of toUpdate) {
    await prisma.enquiryItem.update({
      where: { id: u.row.id },
      data: { itemNameMerge: u.next },
    });
    updated++;
    if (updated % 100 === 0) {
      process.stdout.write(`\rUpdated ${updated}/${toUpdate.length}...`);
    }
  }
  console.log(`\n\nDone. Updated ${updated} items.\n`);
  console.log("Verify: SELECT COUNT(*) FROM \"EnquiryItem\" WHERE ((\"others\" != '{}'::text[] OR \"extension\" IS NOT NULL OR \"bypass\" IS NOT NULL) AND \"itemNameMerge\" NOT LIKE '%WITH-%'); -- rows with suffix values lacking WITH- in merge\n");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });