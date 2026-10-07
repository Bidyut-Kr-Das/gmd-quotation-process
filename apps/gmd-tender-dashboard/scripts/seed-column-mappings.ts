import { prisma } from "../lib/prisma";
import { COLUMN_MAP } from "../lib/tender-columns";

async function main() {
  const entries = Object.entries(COLUMN_MAP);
  console.log(`Seeding ${entries.length} column mappings...`);

  let created = 0;
  let skipped = 0;

  // for (const [excelHeader, dbField] of entries) {
  //   try {
  //     await prisma.columnMapping.upsert({
  //       where: { excelHeader_dbField: { excelHeader, dbField } },
  //       update: {},
  //       create: { excelHeader, dbField, status: "active" },
  //     });
  //     created++;
  //   } catch (err) {
  //     console.error(`Failed to upsert ${excelHeader} -> ${dbField}:`, err);
  //     skipped++;
  //   }
  // }

  console.log(`Done. ${created} created/upserted, ${skipped} skipped.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
