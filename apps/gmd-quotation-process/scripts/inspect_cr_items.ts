import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.contractReview.findMany({
    select: { item: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const val = r.item ?? "<null>";
    map.set(val, (map.get(val) ?? 0) + 1);
  }
  console.log("Distinct ContractReview.item values:");
  for (const [k, v] of map) {
    console.log(`- "${k}": ${v} rows`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
