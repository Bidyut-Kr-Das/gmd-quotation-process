import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  // Clean state names matching STATIC_STATES
  { state: "WEST BENGAL", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "MAHARASHTRA", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "MADHYA PRADESH", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "KARNATAKA", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "GUJARAT", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "TAMIL NADU", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "CHHATTISGARH", fullLoad: "3.00%", partLoad: "6.00%" },
  { state: "ODISHA", fullLoad: "2.50%", partLoad: "4.00%" },
  { state: "JHARKHAND", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "TELANGANA", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "UTTAR PRADESH", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "RAJASTHAN", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "ANDHRA PRADESH", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "HARYANA", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "BIHAR", fullLoad: "2.00%", partLoad: "5.00%" },
  { state: "KERALA", fullLoad: "6.00%", partLoad: "9.00%" },
  { state: "DELHI", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "HIMACHAL PRADESH", fullLoad: "7.00%", partLoad: "10.00%" },
  { state: "MEGHALAYA", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "ASSAM", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "PUNJAB", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "GOA", fullLoad: "5.00%", partLoad: "8.00%" },
  { state: "UTTARAKHAND", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "ARUNACHAL PRADESH", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "MANIPUR", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "MIZORAM", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "NAGALAND", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "SIKKIM", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "TRIPURA", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "ANDAMAN", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "ANDAMAN & NICOBAR", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "J&K", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "JAMMU & KASHMIR", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "PUDUCHERRY", fullLoad: "15.00%", partLoad: "15.00%" },
  { state: "PONDICHERRY", fullLoad: "15.00%", partLoad: "15.00%" },
  { state: "OTHER COUNTRY", fullLoad: "0.00%", partLoad: "0.00%" },
  { state: "Ex-Works - Kharagpur", fullLoad: "0.50%", partLoad: "0.50%" },
  { state: "FOR (Site)", fullLoad: "10.00%", partLoad: "15.00%" },

  // Legacy "FOR (Site In ...)" formats to maintain backward compatibility
  { state: "FOR (Site In West Bengal)", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "FOR (Site In Maharashtra)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Madhya Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Karnataka)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Gujarat)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Tamil Nadu)", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Chattisgarh)", fullLoad: "3.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Chhattisgarh)", fullLoad: "3.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Odisha)", fullLoad: "2.50%", partLoad: "4.00%" },
  { state: "FOR (Site In Jharkhand)", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "FOR (Site In Telangana)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Uttar Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Rajasthan)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Andhra Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Haryana)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Bihar)", fullLoad: "2.00%", partLoad: "5.00%" },
  { state: "FOR (Site In Kerala)", fullLoad: "6.00%", partLoad: "9.00%" },
  { state: "FOR (Site In Delhi)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Himachal Pradesh)", fullLoad: "7.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Meghalaya)", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "FOR (Site In Assam)", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "FOR (Site In Punjab)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Goa)", fullLoad: "5.00%", partLoad: "8.00%" },
  { state: "FOR (Site In Pondicherry)", fullLoad: "15.00%", partLoad: "15.00%" },
  { state: "FOR (Site In Puducherry)", fullLoad: "15.00%", partLoad: "15.00%" },
  { state: "FOR (Site In Uttrakhand)", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Uttarakhand)", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Andaman)", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "FOR (Site In J&K)", fullLoad: "25.00%", partLoad: "25.00%" },
];

async function main() {
  console.log("Seeding Transportation Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    const normalizedState = entry.state.trim();
    await prisma.transportationCost.upsert({
      where: { state: normalizedState },
      update: { fullLoad: entry.fullLoad, partLoad: entry.partLoad },
      create: { state: normalizedState, fullLoad: entry.fullLoad, partLoad: entry.partLoad },
    });
    console.log(`Upserted: State = "${normalizedState}" -> Full = ${entry.fullLoad}, Part = ${entry.partLoad}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
