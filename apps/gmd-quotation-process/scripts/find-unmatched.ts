import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      utility: true,
      state: true,
      enquiryDate: true
    }
  });

  // Get all threads with docketNo
  const existingMatchedThreads = await prisma.docketQuotationThread.findMany({
    where: {
      docketNo: { in: enquiries.map(e => e.docketNumber) }
    },
    select: { docketNo: true }
  });

  const matchedSet = new Set(existingMatchedThreads.map(t => t.docketNo?.trim().toLowerCase()));
  const unmatched = enquiries.filter(e => !matchedSet.has(e.docketNumber.trim().toLowerCase()));

  console.log(`Matched Enquiries: ${enquiries.length - unmatched.length}`);
  console.log(`Unmatched Enquiries: ${unmatched.length}`);

  // Let's test 20 unmatched enquiries to see if their docketNumber or part of it appears in docket_quotation_threads
  console.log("\nSearching for 20 unmatched enquiries across all 6746 threads:");
  for (const enq of unmatched.slice(0, 20)) {
    const raw = enq.docketNumber.trim();
    // Try multiple variations:
    // e.g. "GMD/2026-27/076" -> "2026-27/076", "076", "76", "GMD003260" -> "3260"
    const numMatch = raw.match(/\d+$/);
    const lastNum = numMatch ? numMatch[0] : "";
    const cleanNum = lastNum ? String(parseInt(lastNum, 10)) : "";

    const foundByExact = await prisma.docketQuotationThread.findMany({
      where: {
        OR: [
          { subject: { contains: raw, mode: "insensitive" } },
          { body: { contains: raw, mode: "insensitive" } },
          { ocrText: { contains: raw, mode: "insensitive" } },
        ]
      },
      take: 2,
      select: { id: true, subject: true, docketNo: true }
    });

    console.log(`\nEnquiry: "${raw}" (Party: "${enq.partyName}")`);
    if (foundByExact.length > 0) {
      console.log(`  -> FOUND BY EXACT DOCKET NO (${foundByExact.length}):`, foundByExact.map(f => `[ID:${f.id}, existingDocketNo:"${f.docketNo}", Subj:"${f.subject}"]`));
    } else {
      // Try searching by party name
      const partyFirstWord = enq.partyName ? enq.partyName.split(" ")[0] : "";
      if (partyFirstWord && partyFirstWord.length > 3) {
        const foundByParty = await prisma.docketQuotationThread.findMany({
          where: {
            OR: [
              { subject: { contains: partyFirstWord, mode: "insensitive" } },
              { body: { contains: partyFirstWord, mode: "insensitive" } },
              { sender: { contains: partyFirstWord, mode: "insensitive" } },
            ]
          },
          take: 2,
          select: { id: true, subject: true, docketNo: true }
        });
        if (foundByParty.length > 0) {
          console.log(`  -> FOUND BY PARTY ("${partyFirstWord}"):`, foundByParty.map(f => `[ID:${f.id}, existingDocketNo:"${f.docketNo}", Subj:"${f.subject}"]`));
        } else {
          console.log(`  -> No match found for docket or party.`);
        }
      } else {
        console.log(`  -> No match found.`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
