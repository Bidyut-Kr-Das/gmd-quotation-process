import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const enquiries = await prisma.enquiry.findMany({
    orderBy: { docketNumber: "asc" },
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      state: true,
      orderStatus: true,
      closureStatus: true,
      contractNo: true,
      selectedContractNo: true,
      projectReference: true,
      attachments: { select: { name: true, url: true } },
      items: { select: { itemName: true } }
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
  const cutoff = new Date("2026-02-12T00:00:00Z");

  const cat1_preSync: typeof pending = [];
  const cat2_genericDriveNoEmail: typeof pending = [];
  const cat3_postFebNoMail: typeof pending = [];

  for (const p of pending) {
    if (p.enquiryDate && p.enquiryDate < cutoff) {
      cat1_preSync.push(p);
    } else if (p.attachments.every(a => a.name.startsWith("Drive_File_")) && p.contractNo.length > 0) {
      cat2_genericDriveNoEmail.push(p);
    } else {
      cat3_postFebNoMail.push(p);
    }
  }

  console.log(`======================================================`);
  console.log(`FORENSIC AUDIT OF THE REMAINING ${pending.length} ACTION PENDING ENQUIRIES`);
  console.log(`======================================================`);
  console.log(`Category 1 (Pre-Sync Date Cutoff - Before 12 Feb 2026): ${cat1_preSync.length} dockets`);
  console.log(`Category 2 (ERP / Bulk Contract imports with generic Drive files, no emails in mailbox): ${cat2_genericDriveNoEmail.length} dockets`);
  console.log(`Category 3 (Post-Feb Enquiries with no corresponding email thread in database): ${cat3_postFebNoMail.length} dockets\n`);

  console.log("Top Parties in Category 1 (Pre-Sync):");
  const pMap1: Record<string, number> = {};
  cat1_preSync.forEach(p => pMap1[p.partyName] = (pMap1[p.partyName] || 0) + 1);
  Object.entries(pMap1).sort((a,b)=>b[1]-a[1]).slice(0, 5).forEach(([k,v]) => console.log(` - ${k}: ${v}`));

  console.log("\nTop Parties in Category 2 (ERP / Drive Generic):");
  const pMap2: Record<string, number> = {};
  cat2_genericDriveNoEmail.forEach(p => pMap2[p.partyName] = (pMap2[p.partyName] || 0) + 1);
  Object.entries(pMap2).sort((a,b)=>b[1]-a[1]).slice(0, 5).forEach(([k,v]) => console.log(` - ${k}: ${v}`));

  console.log("\nTop Parties in Category 3 (No Mailbox Thread):");
  const pMap3: Record<string, number> = {};
  cat3_postFebNoMail.forEach(p => pMap3[p.partyName] = (pMap3[p.partyName] || 0) + 1);
  Object.entries(pMap3).sort((a,b)=>b[1]-a[1]).slice(0, 5).forEach(([k,v]) => console.log(` - ${k}: ${v}`));
}

main().then(() => process.exit(0)).catch(console.error);
