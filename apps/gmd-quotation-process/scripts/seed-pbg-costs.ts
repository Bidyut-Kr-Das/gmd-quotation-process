import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  { pbg: "5% For 24 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "7.5% For 24 Months from date of invoice.", costPct: "7.50%" },
  { pbg: "10% For 24 Months  from date of invoice.", costPct: "10.00%" },
  { pbg: "5% For 36 Months  from date of invoice.", costPct: "5.00%" },
  { pbg: "7.5% For 36 Months  from date of invoice.", costPct: "7.50%" },
  { pbg: "10% For 36 Months  from date of invoice.", costPct: "10.00%" },
  { pbg: "5% For 60 Months  from date of invoice.", costPct: "5.00%" },
  { pbg: "7.5% For 60 Months from date of invoice.", costPct: "7.50%" },
  { pbg: "10% For 60 Months  from date of invoice.", costPct: "10.00%" },
  { pbg: "5% For 66 Months  from date of invoice.", costPct: "5.00%" },
  { pbg: "7.5% For 66 Months  from date of invoice.", costPct: "7.50%" },
  { pbg: "10% For 66 Months  from date of invoice.", costPct: "10.00%" },
  { pbg: "NA", costPct: "0.00%" },
  { pbg: "2.5% For 24 Months from date of invoice.", costPct: "2.50%" },
  { pbg: "10% For 12 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "2.5% For 36 Months  from date of invoice.", costPct: "2.50%" },
  { pbg: "10% For 90days beyond DLP of 10 yrs from date of invoice.", costPct: "10.00%" },
  { pbg: "5% For 4 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 3 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 6 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "10% For 15 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "5% For 17 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "10% For 21 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "10% For 45 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "10% For 69 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "10% For 29 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "3% For 16 Months from date of invoice.", costPct: "3.00%" },
  { pbg: "3% For 27 Months from date of invoice.", costPct: "3.00%" },
  { pbg: "5% For 21 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 31 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 14 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "10% For 24 Months beyond DLP of 30 days from date of invoice.", costPct: "10.00%" },
  { pbg: "3% For 23 Months from date of invoice.", costPct: "3.00%" },
  { pbg: "5% For 60 Months  from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 5 Months  from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 12 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "10% For 14 Months from date of invoice.", costPct: "10.00%" },
  { pbg: "3% For 25 Months from date of invoice.", costPct: "3.00%" },
  { pbg: "3% For 24 Months from date of invoice.", costPct: "3.00%" },
  { pbg: "5% For 22 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 15 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 7 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "5% For 19 Months from date of invoice.", costPct: "5.00%" },
  { pbg: "1% For 36 Months  from date of invoice.", costPct: "1.00%" },
];

async function main() {
  console.log("Seeding PBG Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    // Normalize string key to handle whitespace consistently
    const normalizedPbg = entry.pbg.trim();
    await prisma.pbgCost.upsert({
      where: { pbg: normalizedPbg },
      update: { costPct: entry.costPct },
      create: { pbg: normalizedPbg, costPct: entry.costPct },
    });
    console.log(`Upserted: PBG = "${normalizedPbg}" -> CostPct = ${entry.costPct}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
