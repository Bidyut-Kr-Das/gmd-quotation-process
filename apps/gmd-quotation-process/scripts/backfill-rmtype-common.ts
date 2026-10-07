import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL }),
});

// Default every blank EnquiryItem.rmType to "COMMON". The column default added by
// migration `add_default_in_rmtype` only applies to new inserts, so pre-existing
// null/whitespace rows need this one-time backfill. A value the user later picks
// (or the RM-Type sync writes) is left untouched.
const APPLY = process.argv.includes("--apply");

async function main() {
  const [counts] = await prisma.$queryRaw<{ blanks: number; total: number }[]>`
    SELECT
      count(*) FILTER (WHERE "rmType" IS NULL OR btrim("rmType") = '')::int AS blanks,
      count(*)::int AS total
    FROM "EnquiryItem"`;

  console.log(`EnquiryItems total:       ${counts.total}`);
  console.log(`Blank rmType (to fix):    ${counts.blanks}`);

  if (counts.blanks === 0) {
    console.log("\nNothing to do — no blank rmType rows.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to set these rows to 'COMMON'.");
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE "EnquiryItem"
    SET "rmType" = 'COMMON'
    WHERE "rmType" IS NULL OR btrim("rmType") = ''`;

  const [after] = await prisma.$queryRaw<{ blanks: number }[]>`
    SELECT count(*) FILTER (WHERE "rmType" IS NULL OR btrim("rmType") = '')::int AS blanks
    FROM "EnquiryItem"`;

  console.log(`\nUpdated to COMMON:        ${updated}`);
  console.log(`Blank rmType remaining:   ${after.blanks}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
