import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
async function main() {
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const items = await prisma.enquiryItem.findMany({ select: { size: true } });
const total = items.length;
const blank = items.filter(i => !i.size || i.size === "" || i.size === "-" || i.size === "Not detectable" || i.size === "Not mentioned/cant detect size").length;
console.log("Total items: " + total);
console.log("Blank/null sizes: " + blank);
console.log("Valid sizes: " + (total - blank));
await prisma.$disconnect();
}
main();
