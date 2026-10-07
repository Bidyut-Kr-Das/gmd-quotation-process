import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeDeliverySchedule, DEFAULT_DELIVERY_SCHEDULE } from "../lib/deliverySchedule";
import { resolveImportedInhouse } from "../lib/importInhouseMapping";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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
    const next = computeDeliverySchedule(item.quantity, item.availableStock, item.size, importedInhouse);
    if (next === null) {
      if (item.deliverySchedule !== null) {
        rows.push({
          id: item.id,
          quantity: Number(item.quantity),
          availableStock: item.availableStock,
          from: item.deliverySchedule,
          to: null,
          changed: false,
          reason: "no change (stock < qty or missing)",
        });
      }
      continue;
    }
    rows.push({
      id: item.id,
      quantity: Number(item.quantity),
      availableStock: item.availableStock,
      from: item.deliverySchedule,
      to: next,
      changed: next !== item.deliverySchedule,
      reason: next === DEFAULT_DELIVERY_SCHEDULE ? "stock >= qty" : next,
    });
  }

  const qualified = rows.filter((r) => r.to !== null);
  const toChange = qualified.filter((r) => r.changed);

  console.log("--- PREVIEW (only rows that would qualify for an update) ---");
  for (const row of qualified) {
    if (!row.changed) continue;
    const tag = row.changed ? "CHANGE" : "  same";
    console.log(
      `[${tag}] ${row.id.padEnd(24)} | qty=${String(row.quantity).padEnd(8)} stock=${show(row.availableStock).padStart(10).padEnd(12)} | ${show(row.from).padStart(12)} -> ${show(row.to).padStart(12)}`,
    );
  }

  const unchangedQualified = qualified.filter((r) => !r.changed);
  const missingOrShort = items.length - qualified.length - unchangedQualified.length;

  console.log("\n--- SUMMARY ---");
  console.log(`Total items:                 ${items.length}`);
  console.log(`Qualified (stock >= qty):    ${qualified.length}`);
  console.log(`Would change:                ${toChange.length}`);
  console.log(`Already correct:             ${unchangedQualified.length}`);
  console.log(`No change (stock<qty/blank): ${missingOrShort}`);

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

  console.log(`\nApplied. Updated ${updated} row(s) to "${DEFAULT_DELIVERY_SCHEDULE}". Only deliverySchedule was modified.\n`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());