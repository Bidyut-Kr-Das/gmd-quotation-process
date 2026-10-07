import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  { type: "Client Scope @ 0.75%", costPct: "0.75%" },
  { type: "Client Scope @ 1%", costPct: "1.00%" },
  { type: "Client Scope @ 1.25%", costPct: "1.25%" },
  { type: "Client Scope @ 1.5", costPct: "1.50%" },
  { type: "Client Scope @ 1.75%", costPct: "1.75%" },
  { type: "Client Scope @ 2%", costPct: "2.00%" },
  { type: "Our Scope @ 1%", costPct: "1.00%" },
  { type: "Our Scope @ 1.25%", costPct: "1.25%" },
  { type: "Our Scope @ 1.5%", costPct: "1.50%" },
  { type: "Our Scope @ 1.75%", costPct: "1.75%" },
  { type: "Our Scope @ 2%", costPct: "2.00%" },
  { type: "NA", costPct: "0.00%" },
];

async function main() {
  console.log("Seeding Inspection Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    await prisma.inspectionCost.upsert({
      where: { type: entry.type },
      update: { costPct: entry.costPct },
      create: { type: entry.type, costPct: entry.costPct },
    });
    console.log(`Upserted: Type = "${entry.type}" -> CostPct = ${entry.costPct}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
