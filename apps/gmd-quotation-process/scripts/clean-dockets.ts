import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Fetching all enquiries to check for docket hashtags...");
  const enquiries = await prisma.enquiry.findMany();
  
  let count = 0;
  for (const eq of enquiries) {
    if (eq.docketNumber.includes("#")) {
      const cleanDocket = eq.docketNumber.replace(/#/g, "").trim();
      console.log(`Cleaning docket: "${eq.docketNumber}" -> "${cleanDocket}"`);
      
      try {
        await prisma.enquiry.update({
          where: { id: eq.id },
          data: { docketNumber: cleanDocket },
        });
        count++;
      } catch (err: any) {
        console.error(`[ERROR] Failed to clean docket ID ${eq.id}:`, err.message);
      }
    }
  }

  console.log(`\nCleanup complete! Cleaned ${count} dockets in the database.`);
  await prisma.$disconnect();
}

main().catch(console.error);
