import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { formatValidityLabel } from "../lib/pbg/validity";

const adapter = new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(
    `\n=== NORMALISE PBG validityOn [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const rows = await prisma.pbgData.findMany({
    select: { id: true, validityOn: true },
  });
  console.log(`PbgData rows: ${rows.length}\n`);

  type Change = { id: bigint; from: string; to: string };
  const changes: Change[] = [];
  let blank = 0;
  let unparseable = 0;

  for (const row of rows) {
    const raw = row.validityOn;
    if (raw === null || raw.trim() === "") {
      blank += 1;
      continue;
    }
    const label = formatValidityLabel(raw);
    if (!label) {
      unparseable += 1;
      continue;
    }
    if (label !== raw) changes.push({ id: row.id, from: raw, to: label });
  }

  console.log("--- PREVIEW (rows that would change) ---");
  for (const change of changes) {
    console.log(
      `[CHANGE] ${change.id.toString().padEnd(8)} | ${show(change.from)} -> ${change.to}`,
    );
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Total rows:        ${rows.length}`);
  console.log(`Would change:      ${changes.length}`);
  console.log(`Already canonical: ${rows.length - blank - unparseable - changes.length}`);
  console.log(`Blank/null:        ${blank}`);
  console.log(`Unparseable:       ${unparseable}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.\n");
    return;
  }

  let updated = 0;
  for (const change of changes) {
    await prisma.pbgData.update({
      where: { id: change.id },
      data: { validityOn: change.to, updatedAt: new Date() },
    });
    updated += 1;
  }

  console.log(`\nApplied. Updated ${updated} row(s).\n`);
}

main()
  .catch((err) => {
    console.error("Normalise failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
