import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveImportedInhouse } from "../lib/importInhouseMapping";
import { computeDeliverySchedule } from "../lib/deliverySchedule";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(`\n=== BACKFILL IMPORT/IN-HOUSE + DELIVERY SCHEDULE [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

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

  type Row = {
    id: string;
    itemType: string | null;
    size: string | null;
    importFrom: string | null;
    importTo: string | null;
    scheduleFrom: string | null;
    scheduleTo: string | null;
    changed: boolean;
  };

  const rows: Row[] = [];

  for (const item of items) {
    const importTo = resolveImportedInhouse(item.itemType, item.size, item.itemName);
    const scheduleTo = computeDeliverySchedule(
      item.quantity,
      item.availableStock,
      item.size,
      importTo
    );
    const importChanged = importTo !== item.importedInhouse;
    const scheduleChanged = scheduleTo !== null && scheduleTo !== item.deliverySchedule;

    if (importChanged || scheduleChanged) {
      rows.push({
        id: item.id,
        itemType: item.itemType,
        size: item.size,
        importFrom: item.importedInhouse,
        importTo,
        scheduleFrom: item.deliverySchedule,
        scheduleTo: scheduleChanged ? scheduleTo : item.deliverySchedule,
        changed: true,
      });
    }
  }

  console.log("--- PREVIEW (rows that would change) ---");
  for (const row of rows) {
    console.log(
      `[CHANGE] ${row.id.padEnd(24)} | type=${show(row.itemType).padEnd(30)} size=${show(row.size).padStart(6)} | ` +
        `${show(row.importFrom).padStart(9)} -> ${show(row.importTo).padStart(9)} | ` +
        `${show(row.scheduleFrom).padStart(12)} -> ${show(row.scheduleTo).padStart(12)}`
    );
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Total items:     ${items.length}`);
  console.log(`Would change:    ${rows.length}`);
  console.log(`No change:       ${items.length - rows.length}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write importedInhouse + deliverySchedule.\n");
    return;
  }

  let updated = 0;
  for (const row of rows) {
    const data: { importedInhouse?: string | null; deliverySchedule?: string | null } = {};
    data.importedInhouse = row.importTo;
    if (row.scheduleTo !== null && row.scheduleTo !== row.scheduleFrom) {
      data.deliverySchedule = row.scheduleTo;
    }
    await prisma.enquiryItem.update({ where: { id: row.id }, data });
    updated++;
  }

  console.log(`\nApplied. Updated ${updated} row(s).\n`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
