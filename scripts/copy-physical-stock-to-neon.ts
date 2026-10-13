import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { neonPrisma } from "@/lib/neonPrisma";

/**
 * One-time copy of the local `PhysicalStock` table into Neon (the second
 * datasource now serving the physical stock page).
 *
 *   npm run physical:copy-neon          # dry run (counts only)
 *   npm run physical:copy-neon:apply    # upsert rows into Neon
 *
 * Rows are keyed by `id`, so re-running is safe: existing ids are skipped via
 * `skipDuplicates` while missing ids are inserted.
 */

const apply = process.argv.includes("--apply");
const CHUNK = 500;

const FIELDS = [
  "id",
  "erp_code",
  "location",
  "l2_valve_type",
  "dimension",
  "l7_dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
  "available_qty",
  "remarks",
  "sum_of_physical_stock",
  "stock_as_per_erp",
  "rate_unit",
  "rate_per_pc_qty_weight",
  "weight_per_pc",
  "item_wise_value",
  "moving_within_3_months",
  "order_ag_approval_recvd",
  "purchase_in_26_27",
  "dispatched_in_26_27",
  "order_in_hand_qty",
  "shortage_qty",
  "unnamed_aa",
  "item_type",
  "price",
  "moq",
  "if_less_than_moq_extra_charges",
  "drawing_technical_data",
  "cost",
  "bom_id",
  "created_at",
  "updated_at",
] as const;

type LocalRow = Record<string, unknown>;

function toNeonRow(row: LocalRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of FIELDS) out[field] = row[field] ?? null;
  return out;
}

async function main() {
  console.log(
    `\n=== Physical Stock -> Neon ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`,
  );

  const rows = (await prisma.physicalStock.findMany()) as unknown as LocalRow[];
  const payload = rows.map(toNeonRow);
  console.log(`Local rows         : ${payload.length}`);

  const existingIds = new Set(
    (await neonPrisma.physicalStock.findMany({ select: { id: true } })).map(
      (r) => r.id,
    ),
  );
  console.log(`Already in Neon    : ${existingIds.size}`);

  const toInsert = payload.filter((r) => !existingIds.has(r.id as string));
  console.log(`Rows to insert     : ${toInsert.length}`);

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const result = await neonPrisma.physicalStock.createMany({
      data: chunk as never,
      skipDuplicates: true,
    });
    inserted += result.count;
    console.log(`  ...inserted ${inserted}/${toInsert.length}`);
  }

  console.log(`\nDone. Inserted ${inserted} row(s) into Neon.\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await neonPrisma.$disconnect();
  });
