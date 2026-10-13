import { PrismaClient } from "@/app/generated/prisma-neon";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.NEON_DATABASE_URL,
});
const globalForPrisma = global as unknown as { neonPrisma: PrismaClient };

let neonPrismaInstance: PrismaClient;

if (process.env.NODE_ENV === "production") {
  neonPrismaInstance = new PrismaClient({ adapter });
} else {
  if (!globalForPrisma.neonPrisma) {
    globalForPrisma.neonPrisma = new PrismaClient({ adapter });
  }
  neonPrismaInstance = globalForPrisma.neonPrisma;
}

export const neonPrisma = neonPrismaInstance;
