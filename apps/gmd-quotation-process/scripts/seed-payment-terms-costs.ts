import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  {
    terms: "20% advance against order & 80 % Against Proforma Invoice immediately after Inspection.",
    costPct: "0.00%",
  },
  {
    terms: "20% advance against order & 80 % Within 30 Days from the date of receipt of material at site.",
    costPct: "1.00%",
  },
  {
    terms: "30 days Open credit from date of Dispatch of material",
    costPct: "1.00%",
  },
  {
    terms: "60 days Open credit from date of Dispatch of material",
    costPct: "2.00%",
  },
  {
    terms: "60 days Letter of credit prior to date of supply with interest in Buyer Account",
    costPct: "0.00%",
  },
  {
    terms: "30 days Letter of credit prior to date of supply with interest in Buyer Account",
    costPct: "0.00%",
  },
  {
    terms: "60 days Letter of credit prior to date of supply with interest in Seller Account",
    costPct: "2.00%",
  },
  {
    terms: "30 days Letter of credit prior to date of supply with interest in Seller Account",
    costPct: "1.00%",
  },
  {
    terms: "90 days Letter of credit prior to date of supply with interest in Buyer Account",
    costPct: "0.00%",
  },
  {
    terms: "90 days Letter of credit prior to date of supply with interest in Seller'S Account",
    costPct: "3.00%",
  },
  {
    terms: "90 days Open credit from date of Dispatch of material",
    costPct: "3.00%",
  },
  {
    terms: "45 days Open credit from date of Dispatch of material",
    costPct: "1.50%",
  },
  {
    terms: "60 days PDC prior to date of supply.",
    costPct: "2.00%",
  },
  {
    terms: "07 days Open credit from date of Dispatch of material",
    costPct: "0.50%",
  },
  {
    terms: "180 days Letter of credit prior to date of supply with interest in Seller'S Account",
    costPct: "6.00%",
  },
  {
    terms: "100 % Against Proforma Invoice Prior To Dispatch.",
    costPct: "0.00%",
  },
  {
    terms: "15% Advance Along With PO and Balance 85% Against Proforma Invoice Prior To Dispatch",
    costPct: "0.00%",
  },
  {
    terms: "20% Advance Along With PO and Balance 80% Against 45 Days Bank L/c Prior To Dispatch",
    costPct: "1.50%",
  },
  {
    terms: "90 days hundi: against MRN & BILL SUBMISSION whichever is later",
    costPct: "3.00%",
  },
  {
    terms: "45 days Letter of credit from date of Dispatch of material",
    costPct: "1.50%",
  },
  {
    terms: "180 days VFS  with interest in Seller'S Account",
    costPct: "6.00%",
  },
];

async function main() {
  console.log("Seeding Payment Terms Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    await prisma.paymentTermsCost.upsert({
      where: { terms: entry.terms },
      update: { costPct: entry.costPct },
      create: { terms: entry.terms, costPct: entry.costPct },
    });
    console.log(`Upserted: Terms = "${entry.terms}" -> CostPct = ${entry.costPct}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
