import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Searching for specific GMD slash enquiries in threads...");

  const searchDockets = [
    { docket: "GMD/2026-27/006", num: "006", party: "Larsen" },
    { docket: "GMD/2026-27/019", num: "019", party: "KEC" },
    { docket: "GMD/2026-27/045", num: "045", party: "Miller" },
    { docket: "GMD/2026-27/063", num: "063", party: "Jain" },
    { docket: "GMD/2026-27/076", num: "076", party: "Zuberi" },
    { docket: "GMD/2026-27/119", num: "119", party: "NTPC" },
    { docket: "GMD/2026-27/257", num: "257", party: "Kalpataru" },
    { docket: "GMD/2026-27/303", num: "303", party: "NCC" },
  ];

  for (const s of searchDockets) {
    console.log(`\n======================================================`);
    console.log(`Checking ${s.docket} (${s.party}, num ${s.num}):`);
    
    // Check if the number appears anywhere in docket_no, subject, or attach_names
    const threads = await prisma.docketQuotationThread.findMany({
      where: {
        OR: [
          { subject: { contains: s.docket } },
          { subject: { contains: `26-27/${s.num}` } },
          { subject: { contains: `26-27/${parseInt(s.num, 10)}` } },
          { subject: { contains: `GMD ${s.num}` } },
          { subject: { contains: `GMD-${s.num}` } },
          { subject: { contains: `GMD/${s.num}` } },
          { docketNo: { contains: s.num } }
        ]
      },
      select: { id: true, docketNo: true, subject: true, date: true, sender: true, attachNames: true }
    });

    console.log(`Found ${threads.length} threads by docket variation:`);
    for (const t of threads) {
      console.log(` - ID: ${t.id} | Date: ${t.date?.toISOString().split("T")[0]} | Docket: ${t.docketNo || 'NONE'}`);
      console.log(`   Subject: ${t.subject}`);
      console.log(`   Attach: ${JSON.stringify(t.attachNames)}`);
    }

    // Now search by party name alone around the date
    const enq = await prisma.enquiry.findUnique({
      where: { docketNumber: s.docket },
      select: { enquiryDate: true, attachments: true }
    });

    if (enq && enq.enquiryDate) {
      const enqDate = new Date(enq.enquiryDate);
      const start = new Date(enqDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const end = new Date(enqDate.getTime() + 14 * 24 * 60 * 60 * 1000);

      const partyThreads = await prisma.docketQuotationThread.findMany({
        where: {
          date: { gte: start, lte: end },
          OR: [
            { subject: { contains: s.party, mode: "insensitive" } },
            { sender: { contains: s.party, mode: "insensitive" } }
          ]
        },
        select: { id: true, docketNo: true, subject: true, date: true, sender: true, attachNames: true }
      });

      console.log(`Party search around ${enqDate.toISOString().split("T")[0]} (-7 to +14 days): Found ${partyThreads.length} threads:`);
      for (const pt of partyThreads) {
        console.log(`   * ID: ${pt.id} | Date: ${pt.date?.toISOString().split("T")[0]} | Docket: ${pt.docketNo || 'NONE'} | Subj: ${pt.subject}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
