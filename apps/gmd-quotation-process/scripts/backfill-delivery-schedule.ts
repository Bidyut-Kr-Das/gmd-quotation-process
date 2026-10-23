import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeDeliverySchedule, DEFAULT_DELIVERY_SCHEDULE } from "../lib/deliverySchedule";
import { resolveImportedInhouse } from "../lib/importInhouseMapping";

const adapter = new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(`\n=== BACKFILL DELIVERY SCHEDULE [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  const items = await prisma.enquiryItem.findMany({
    where: { deliveryScheduleOverride: false },
    select: {
      id: true,
      itemName: true,
      itemType: true,
      size: true,
      quantity: true,
      availableStock: true,
      importedInhouse: true,
      deliverySchedule: true,
    },
  });
  console.log(`EnquiryItem rows: ${items.length}\n`);

  const rows: {
    id: string;
    quantity: number;
    availableStock: string | null;
    from: string | null;
    to: string | null;
    changed: boolean;
    reason: string;
  }[] = [];

  for (const item of items) {
    const importedInhouse =
      item.importedInhouse ?? resolveImportedInhouse(item.itemType, item.size, item.itemName);
    // Fill blanks with the default, but never replace an existing specific value
    // just because stock/qty are unknown.
    const next =
      computeDeliverySchedule(item.quantity, item.availableStock, item.size, importedInhouse) ??
      (item.deliverySchedule?.trim() ? item.deliverySchedule : DEFAULT_DELIVERY_SCHEDULE);
    rows.push({
      id: item.id,
      quantity: Number(item.quantity),
      availableStock: item.availableStock,
      from: item.deliverySchedule,
      to: next,
      changed: next !== item.deliverySchedule,
      reason: next === DEFAULT_DELIVERY_SCHEDULE ? "default (stock >= qty or unknown)" : next,
    });
  }

  const toChange = rows.filter((r) => r.changed);

  console.log("--- PREVIEW (only rows that would be updated) ---");
  for (const row of rows) {
    if (!row.changed) continue;
    console.log(
      `[CHANGE] ${row.id.padEnd(24)} | qty=${String(row.quantity).padEnd(8)} stock=${show(row.availableStock).padStart(10).padEnd(12)} | ${show(row.from).padStart(12)} -> ${show(row.to).padStart(12)}`,
    );
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Total items:      ${items.length}`);
  console.log(`Would change:     ${toChange.length}`);
  console.log(`Already correct:  ${rows.length - toChange.length}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write deliverySchedule.\n");
    return;
  }

  let updated = 0;
  for (const row of toChange) {
    await prisma.enquiryItem.update({
      where: { id: row.id },
      data: { deliverySchedule: row.to },
    });
    updated++;
  }

  console.log(`\nApplied. Updated ${updated} row(s). Only deliverySchedule was modified.\n`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());