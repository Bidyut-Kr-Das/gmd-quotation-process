import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  { size: "40", cost: "6000" },
  { size: "50", cost: "6473" },
  { size: "65", cost: "7120" },
  { size: "80", cost: "7624" },
  { size: "100", cost: "9268" },
  { size: "125", cost: "12745" },
  { size: "150", cost: "16219" },
  { size: "200", cost: "23395" },
  { size: "250", cost: "28516" },
  { size: "300", cost: "36658" },
  { size: "25", cost: "5800" },
];

async function main() {
  console.log("Seeding Bypass Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    await prisma.bypassCost.upsert({
      where: { size: entry.size },
      update: { cost: entry.cost },
      create: { size: entry.size, cost: entry.cost },
    });
    console.log(`Upserted: Size = ${entry.size} -> Cost = ${entry.cost}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
