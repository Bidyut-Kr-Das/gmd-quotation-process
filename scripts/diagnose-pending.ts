import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const totalThreads = await prisma.docketQuotationThread.count();
  const threadsWithDocket = await prisma.docketQuotationThread.count({
    where: { docketNo: { not: null } }
  });
  const threadsWithoutDocket = await prisma.docketQuotationThread.count({
    where: { OR: [{ docketNo: null }, { docketNo: "" }] }
  });

  const totalEnquiries = await prisma.enquiry.count();

  console.log(`Total threads in DB: ${totalThreads}`);
  console.log(`Threads WITH docket_no: ${threadsWithDocket}`);
  console.log(`Threads WITHOUT docket_no: ${threadsWithoutDocket}`);
  console.log(`Total Enquiries in DB: ${totalEnquiries}`);

  // Sample enquiry docket numbers
  const enquiries = await prisma.enquiry.findMany({
    select: { docketNumber: true, partyName: true }
  });

  console.log("\nSample 20 Enquiry Docket Numbers:");
  for (const e of enquiries.slice(0, 20)) {
    console.log(`- "${e.docketNumber}" | Party: "${e.partyName}"`);
  }

  // Sample threads without docket
  const sampleEmptyThreads = await prisma.docketQuotationThread.findMany({
    where: { OR: [{ docketNo: null }, { docketNo: "" }] },
    take: 10,
    select: { id: true, subject: true, sender: true, attachNames: true, bodyPreview: true }
  });

  console.log("\nSample 10 Threads WITHOUT docket_no:");
  for (const t of sampleEmptyThreads) {
    console.log(`ID: ${t.id} | Subject: "${t.subject}" | Attachments: ${JSON.stringify(t.attachNames)}`);
  }
}

main().then(() => process.exit(0)).catch(console.error);
