import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const enquiries = await prisma.enquiry.findMany({
    orderBy: { docketNumber: "asc" },
    select: {
      docketNumber: true,
      partyName: true,
      utility: true,
      projectReference: true,
      attachments: { select: { name: true } }
    }
  });

  const assignedThreads = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { not: null } },
    select: { docketNo: true }
  });

  const matchedSet = new Set<string>();
  for (const t of assignedThreads) {
    if (!t.docketNo) continue;
    t.docketNo.split(",").forEach(d => matchedSet.add(d.trim().toLowerCase()));
  }

  const pending = enquiries.filter(e => !matchedSet.has(e.docketNumber.trim().toLowerCase()));

  console.log(`Checking attachments for all ${pending.length} pending enquiries...`);

  for (const p of pending) {
    const nonGeneric = p.attachments.filter(a => !a.name.startsWith("Drive_File_"));
    if (nonGeneric.length > 0) {
      console.log(`\nDocket: ${p.docketNumber} | Party: ${p.partyName} | Proj/Util: ${p.projectReference || p.utility || 'None'}`);
      nonGeneric.forEach(a => console.log(`  Attachment: "${a.name}"`));
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
