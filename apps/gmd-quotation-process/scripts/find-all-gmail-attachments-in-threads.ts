import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Searching for specific terms from Gmail PDF and GeM attachments in docket_quotation_threads...");

  const searchList = [
    { docket: "GMD/2026-27/303", query: "WSIS - ujjain" },
    { docket: "GMD/2026-27/309", query: "UPPR PROJECT" },
    { docket: "GMD/2026-27/258", query: "OMKI Project" },
    { docket: "GMD/2026-27/266", query: "OMC ETP" },
    { docket: "GMD/2026-27/268", query: "9468530" },
    { docket: "GMD/2026-27/275", query: "9542550" },
    { docket: "GMD/2026-27/281", query: "9514516" },
    { docket: "GMD/2026-27/310", query: "9629802" },
    { docket: "GMD/2026-27/311", query: "9502382" },
    { docket: "GMD/2026-27/319", query: "9611095" },
    { docket: "GMD/2026-27/273", query: "Kesinga" },
    { docket: "GMD/2026-27/273", query: "Lanjigarh" },
    { docket: "GMD/2026-27/329", query: "GOA Project" },
    { docket: "GMD/2026-27/399", query: "Silchar" },
    { docket: "GMD/2026-27/313", query: "Facile Maven" },
    { docket: "GMD/2026-27/263", query: "BARC" },
    { docket: "GMD/2026-27/202", query: "Kampil" },
  ];

  const results: Array<{ docket: string; query: string; threadId: number; subject: string; sender: string; date: string }> = [];

  for (const item of searchList) {
    const threads = await prisma.docketQuotationThread.findMany({
      where: {
        OR: [
          { subject: { contains: item.query, mode: "insensitive" } },
          { bodyPreview: { contains: item.query, mode: "insensitive" } },
          { attachNames: { string_contains: item.query } }
        ]
      },
      select: { id: true, subject: true, sender: true, date: true, docketNo: true }
    });

    if (threads.length > 0) {
      for (const t of threads) {
        results.push({
          docket: item.docket,
          query: item.query,
          threadId: t.id,
          subject: t.subject || "",
          sender: t.sender || "",
          date: t.date?.toISOString().split("T")[0] || ""
        });
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`RESULTS FOUND: ${results.length} matches`);
  console.log(`======================================================`);
  for (const r of results) {
    console.log(`Docket: ${r.docket} (Query: "${r.query}") -> Thread ID: ${r.threadId} (Date: ${r.date})`);
    console.log(`  Subject: ${r.subject}`);
    console.log(`  Sender: ${r.sender}\n`);
  }
}

main().then(() => process.exit(0)).catch(console.error);
