import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Fetching all enquiry items...");
  const items = await prisma.enquiryItem.findMany();
  
  let count = 0;
  for (const item of items) {
    const qty = item.quantity ? parseFloat(item.quantity.toString()) : 0;
    const quotedRateVal = item.quotedRate ? parseFloat(item.quotedRate.toString()) : 0;

    if (qty > 0 && quotedRateVal > 0) {
      const itemWise = qty * quotedRateVal;
      const itemWiseTotal = itemWise.toFixed(2);
      const totalVal = (itemWise * 1.18).toFixed(2);

      console.log(`Item ID ${item.id} (${item.itemName}): Qty=${qty}, QuotedRate=${quotedRateVal} -> ItemWiseTotal=${itemWiseTotal}, Total=${totalVal}`);

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          itemWiseTotalValue: itemWiseTotal,
          totalValue: totalVal,
        },
      });
      count++;
    }
  }

  console.log(`\nMigration complete! Updated ${count} items in the database.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
