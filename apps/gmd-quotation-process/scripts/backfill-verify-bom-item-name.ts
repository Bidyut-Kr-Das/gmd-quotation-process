import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { recomputeVerifyBomValues } from "../lib/verifyBomLookup";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== BACKFILL VERIFY BOM ITEM NAME (from ContractReview) ===\n");

  const { updated, itemNameMap } = await recomputeVerifyBomValues();

  const totalRows = await prisma.verifyBom.count();
  const codes = [...itemNameMap.keys()].sort();

  console.log(`VerifyBom rows:              ${totalRows}`);
  console.log(`Distinct itemCodes matched:  ${itemNameMap.size}`);
  console.log(`Rows updated (all computed fields incl. itemName): ${updated}`);

  console.log("\n--- ITEM NAME coverage (first 25) ---");
  for (const code of codes.slice(0, 25)) {
    console.log(`  ${code.padEnd(20)} | ${itemNameMap.get(code)}`);
  }
  if (codes.length > 25) {
    console.log(`  ... and ${codes.length - 25} more`);
  }

  console.log("\n=== BACKFILL DONE ===\n");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());