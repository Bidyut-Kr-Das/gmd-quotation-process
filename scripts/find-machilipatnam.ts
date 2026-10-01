import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Searching for MACHILIPATNAM PORT threads in docket_quotation_threads...");

  const threads = await prisma.docketQuotationThread.findMany({
    where: {
      OR: [
        { subject: { contains: "MACHILIPATNAM", mode: "insensitive" } },
        { bodyPreview: { contains: "MACHILIPATNAM", mode: "insensitive" } },
        { body: { contains: "MACHILIPATNAM", mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      threadId: true,
      docketNo: true,
      subject: true,
      sender: true,
      date: true,
      attachNames: true,
      bodyPreview: true
    }
  });

  console.log(`Found ${threads.length} threads for MACHILIPATNAM:`);
  for (const t of threads) {
    console.log(`\nThread ID: ${t.id} | Gmail Thread ID: ${t.threadId}`);
    console.log(`Docket: ${t.docketNo || 'NONE'}`);
    console.log(`Subject: ${t.subject}`);
    console.log(`Sender: ${t.sender}`);
    console.log(`Date: ${t.date?.toISOString().split("T")[0]}`);
    console.log(`Attachments: ${JSON.stringify(t.attachNames)}`);
    console.log(`Preview: ${t.bodyPreview?.slice(0, 200)}`);
  }
}

main().then(() => process.exit(0)).catch(console.error);
