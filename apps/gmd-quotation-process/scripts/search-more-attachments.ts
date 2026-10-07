import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const searchItems = [
    { docket: "GMD/2026-27/266", party: "SJ Environmental", term: "OMC" },
    { docket: "GMD/2026-27/268", party: "NTPC", term: "9468530" },
    { docket: "GMD/2026-27/275", party: "Hindustan Copper", term: "9542550" },
    { docket: "GMD/2026-27/281", party: "GRSE", term: "9514516" },
    { docket: "GMD/2026-27/310", party: "DVC", term: "9629802" },
    { docket: "GMD/2026-27/311", party: "UCIL", term: "9502382" },
    { docket: "GMD/2026-27/319", party: "RCF", term: "9611095" },
    { docket: "GMD/2026-27/273", party: "Vishnu Prakash", term: "Vedanta" },
    { docket: "GMD/2026-27/329", party: "Vishnu Prakash", term: "15 MLD" },
    { docket: "GMD/2026-27/399", party: "Vishnu Prakash", term: "Gearbox" },
    { docket: "GMD/2026-27/278", party: "Shapoorji Pallonji", term: "Shapoorji" },
    { docket: "GMD/2026-27/393", party: "JWIL", term: "JWIL" },
    { docket: "GMD/2026-27/390", party: "L&T", term: "60 MLD" },
  ];

  for (const s of searchItems) {
    const threads = await prisma.docketQuotationThread.findMany({
      where: {
        OR: [
          { subject: { contains: s.term, mode: "insensitive" } },
          { bodyPreview: { contains: s.term, mode: "insensitive" } },
          { sender: { contains: s.term, mode: "insensitive" } },
          { attachNames: { string_contains: s.term } }
        ]
      },
      select: { id: true, subject: true, sender: true, date: true, docketNo: true },
      take: 5
    });

    console.log(`Docket ${s.docket} (${s.party}, query: "${s.term}"): Found ${threads.length} threads`);
    for (const t of threads) {
      console.log(`  - Thread ${t.id} (${t.date?.toISOString().split("T")[0]}): "${t.subject}" | Docket: ${t.docketNo || 'NONE'}`);
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
