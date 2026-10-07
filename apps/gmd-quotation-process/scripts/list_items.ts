import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const countNonNull = await prisma.indentListing.count({
    where: {
      OR: [
        { v1: { not: null } },
        { v2: { not: null } },
        { v3: { not: null } },
        { v4: { not: null } }
      ]
    }
  });
  console.log("Count with non-null v1..v4:", countNonNull);
}
main().finally(() => prisma.$disconnect());
