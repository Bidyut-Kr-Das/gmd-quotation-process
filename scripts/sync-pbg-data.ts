import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchSheetRows } from "../lib/pbg/google";
import { mapRows } from "../lib/pbg/pbg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function show(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== SYNC PBG SHEET -> pbg_data [${apply ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const sheetRows = await fetchSheetRows();
  const { data, skipped } = mapRows(sheetRows);

  console.log(`Sheet rows:   ${sheetRows.length}`);
  console.log(`Mapped rows:  ${data.length}`);
  console.log(`Skipped rows: ${skipped}`);

  if (data.length > 0) {
    console.log("\n--- Sample (first 3 mapped rows) ---");
    for (const row of data.slice(0, 3)) {
      console.log(
        `  ${show(row.clientName)} | ${show(row.poNumber)} | ${show(row.bgNo)} | ` +
          `po=${show(row.poDate)} bg=${show(row.bgDate)} amt=${show(row.bgAmtFc)} | ` +
          `exp=${show(row.expiryDate)} claim=${show(row.claimDate)} | ` +
          `margin=${show(row.marginPct)}/${show(row.marginAmount)} | ` +
          `status=${show(row.status)}`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  if (data.length === 0) {
    console.log("\nRefusing to wipe pbg_data: no rows mapped.\n");
    return;
  }

  const [, inserted] = await prisma.$transaction([
    prisma.pbgData.deleteMany(),
    prisma.pbgData.createMany({ data }),
  ]);

  console.log(`\nApplied: table refreshed with ${inserted.count} rows.\n`);
}

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
