import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Verifying specific target matches in detail...");

  // 1. Check Ujjain WSIS for GMD/2026-27/303
  console.log("\n--- Checking GMD/2026-27/303 (Ujjain WSIS) ---");
  const ujjainThreads = await prisma.docketQuotationThread.findMany({
    where: {
      OR: [
        { subject: { contains: "Ujjain", mode: "insensitive" } },
        { bodyPreview: { contains: "Ujjain", mode: "insensitive" } },
        { body: { contains: "Ujjain", mode: "insensitive" } },
        { subject: { contains: "WSIS", mode: "insensitive" } },
        { bodyPreview: { contains: "WSIS", mode: "insensitive" } },
      ]
    },
    select: { id: true, subject: true, date: true, sender: true, docketNo: true }
  });
  console.log(`Found ${ujjainThreads.length} threads for Ujjain/WSIS:`);
  ujjainThreads.forEach(t => console.log(`  * ID ${t.id} (${t.date?.toISOString().split("T")[0]}): "${t.subject}" | Docket: ${t.docketNo || 'NONE'}`));

  // 2. Check Thread 38321 for GMD/2026-27/309 (UPPR Project)
  console.log("\n--- Checking GMD/2026-27/309 (UPPR Project, Thread 38321) ---");
  const upprThread = await prisma.docketQuotationThread.findUnique({
    where: { id: 38321 },
    select: { id: true, subject: true, date: true, sender: true, docketNo: true, bodyPreview: true }
  });
  console.log(`Thread 38321:`, upprThread);

  // 3. Check OMKI for GMD/2026-27/258
  console.log("\n--- Checking GMD/2026-27/258 (OMKI) ---");
  const omkiThreads = await prisma.docketQuotationThread.findMany({
    where: {
      OR: [
        { subject: { contains: "OMKI", mode: "insensitive" } },
        { bodyPreview: { contains: "OMKI", mode: "insensitive" } },
      ]
    },
    select: { id: true, subject: true, date: true, sender: true, docketNo: true }
  });
  console.log(`Found ${omkiThreads.length} threads for OMKI:`);
  omkiThreads.forEach(t => console.log(`  * ID ${t.id} (${t.date?.toISOString().split("T")[0]}): "${t.subject}" | Docket: ${t.docketNo || 'NONE'}`));

  // 4. Check Thread 9607 (REQUEST FOR CREATE A DOCKET)
  console.log("\n--- Checking Thread 9607 ---");
  const t9607 = await prisma.docketQuotationThread.findUnique({
    where: { id: 9607 },
    select: { id: true, subject: true, date: true, sender: true, docketNo: true, bodyPreview: true }
  });
  console.log(`Thread 9607:`, t9607);

  // 5. Check GMD/2026-27/202 and GMD/2026-27/174 (Urban Development)
  console.log("\n--- Checking GMD/2026-27/202 and GMD/2026-27/174 ---");
  const e174 = await prisma.enquiry.findUnique({
    where: { docketNumber: "GMD/2026-27/174" },
    select: { docketNumber: true, partyName: true }
  });
  const t174 = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { contains: "GMD/2026-27/174" } },
    select: { id: true, subject: true, docketNo: true }
  });
  console.log("Enquiry 174:", e174, "Linked Threads:", t174);

  // 6. Check GMD/2026-27/147 and GMD/2026-27/110 (Sudhakara Infratech)
  console.log("\n--- Checking GMD/2026-27/147 and GMD/2026-27/110 ---");
  const t110 = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { contains: "GMD/2026-27/110" } },
    select: { id: true, subject: true, docketNo: true }
  });
  console.log("Linked Threads for 110:", t110);
}

main().then(() => process.exit(0)).catch(console.error);
