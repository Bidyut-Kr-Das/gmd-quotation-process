import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  { length: "1", cost: "10040" },
  { length: "8", cost: "28520" },
  { length: "3", cost: "15420" },
  { length: "4", cost: "17760" },
  { length: "4.5", cost: "20568" },
  { length: "6", cost: "26640" },
  { length: "5", cost: "27800" },
  { length: "2", cost: "20080" },
];

async function main() {
  console.log("Seeding Extension Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    await prisma.extensionCost.upsert({
      where: { length: entry.length },
      update: { cost: entry.cost },
      create: { length: entry.length, cost: entry.cost },
    });
    console.log(`Upserted: Length = ${entry.length} Mtr -> Cost = ${entry.cost}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
