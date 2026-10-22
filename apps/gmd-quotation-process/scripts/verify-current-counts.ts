import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, docketNumber: true, partyName: true }
  });

  const threads = await prisma.docketQuotationThread.findMany({
    where: {
      docketNo: { in: enquiries.map(e => e.docketNumber) }
    },
    select: { docketNo: true }
  });

  const matchedSet = new Set(threads.map(t => t.docketNo?.trim().toLowerCase()));
  const pendingEnquiries = enquiries.filter(e => !matchedSet.has(e.docketNumber.trim().toLowerCase()));

  console.log(`Total enquiries: ${enquiries.length}`);
  console.log(`Matched (Emails Found): ${enquiries.length - pendingEnquiries.length}`);
  console.log(`Pending (Action Pending): ${pendingEnquiries.length}`);

  console.log(`Is GMD/2026-27/084 in pending?`, pendingEnquiries.some(e => e.docketNumber === "GMD/2026-27/084"));
  console.log(`Is GMD/2026-27/431 in pending?`, pendingEnquiries.some(e => e.docketNumber === "GMD/2026-27/431"));
  console.log(`Is GMD/2026-27/427 in pending?`, pendingEnquiries.some(e => e.docketNumber === "GMD/2026-27/427"));
  console.log(`Is GMD/2026-27/426 in pending?`, pendingEnquiries.some(e => e.docketNumber === "GMD/2026-27/426"));
  console.log(`Is GMD/2026-27/428 in pending?`, pendingEnquiries.some(e => e.docketNumber === "GMD/2026-27/428"));
}

main().then(() => process.exit(0)).catch(console.error);
