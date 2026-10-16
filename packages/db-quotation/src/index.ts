import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { quotationPrisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.quotationPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.quotationPrisma = prisma;
