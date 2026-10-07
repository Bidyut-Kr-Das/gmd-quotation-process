import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Fetching all enquiries with vaPercent values...");
  const enquiries = await prisma.enquiry.findMany({
    where: {
      vaPercent: {
        not: null,
      },
    },
    include: {
      items: true,
    },
  });

  console.log(`Found ${enquiries.length} enquiries to migrate.`);

  let count = 0;
  for (const enq of enquiries) {
    if (enq.vaPercent === null) continue;
    console.log(`Docket ${enq.docketNumber} has VA% = ${enq.vaPercent}. Updating its ${enq.items.length} items...`);
    
    for (const item of enq.items) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          vaPercent: enq.vaPercent !== null ? String(enq.vaPercent) : null,
        },
      });
      count++;
    }
  }

  console.log(`\nVA% migration complete! Copied VA% to ${count} items.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
