import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Searching for dockets that have emails via lifecycle pairs, project names, and attachment email titles...");

  // 1. Fetch all enquiries
  const enquiries = await prisma.enquiry.findMany({
    orderBy: { docketNumber: "asc" },
    include: {
      attachments: true,
      items: true,
    }
  });

  // 2. Fetch all threads with docketNo
  const assignedThreads = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { not: null } },
    select: { id: true, threadId: true, docketNo: true, subject: true, date: true }
  });

  const matchedSet = new Set<string>();
  for (const t of assignedThreads) {
    if (!t.docketNo) continue;
    t.docketNo.split(",").forEach(d => matchedSet.add(d.trim().toLowerCase()));
  }

  const pending = enquiries.filter(e => !matchedSet.has(e.docketNumber.trim().toLowerCase()));
  const alreadyMatched = enquiries.filter(e => matchedSet.has(e.docketNumber.trim().toLowerCase()));

  console.log(`Currently Pending: ${pending.length}`);
  console.log(`Currently Matched: ${alreadyMatched.length}\n`);

  interface PotentialMatch {
    pendingDocket: string;
    party: string;
    type: "LIFECYCLE_PAIR" | "ATTACHMENT_SUBJECT_MATCH" | "PROJECT_UTILITY_MATCH";
    matchedWith: string;
    threadId?: number;
    threadSubject?: string;
    details: string;
  }

  const potentialMatches: PotentialMatch[] = [];

  // STRATEGY 1: Lifecycle / Project pairing with already matched dockets
  // E.g. Same party and same utility or project reference or identical items
  for (const p of pending) {
    const pParty = p.partyName.trim().toLowerCase();
    const pUtility = (p.utility || "").trim().toLowerCase();
    const pProjRef = (p.projectReference || "").trim().toLowerCase();
    const pItems = p.items.map(i => i.itemName.trim().toLowerCase());

    // Check against already matched enquiries
    for (const m of alreadyMatched) {
      const mParty = m.partyName.trim().toLowerCase();
      if (pParty !== mParty) continue;

      const mUtility = (m.utility || "").trim().toLowerCase();
      const mProjRef = (m.projectReference || "").trim().toLowerCase();
      const mItems = m.items.map(i => i.itemName.trim().toLowerCase());

      // Match on distinct project reference
      if (pProjRef && mProjRef && (pProjRef === mProjRef || pProjRef.includes(mProjRef) || mProjRef.includes(pProjRef))) {
        potentialMatches.push({
          pendingDocket: p.docketNumber,
          party: p.partyName,
          type: "LIFECYCLE_PAIR",
          matchedWith: m.docketNumber,
          details: `Same Party & Project Reference: "${p.projectReference}"`
        });
        break;
      }

      // Match on distinct utility (if length >= 5 and not generic)
      if (pUtility && mUtility && pUtility.length >= 6 && !pUtility.includes("n/a") && (pUtility === mUtility || pUtility.includes(mUtility) || mUtility.includes(pUtility))) {
        potentialMatches.push({
          pendingDocket: p.docketNumber,
          party: p.partyName,
          type: "LIFECYCLE_PAIR",
          matchedWith: m.docketNumber,
          details: `Same Party & Utility: "${p.utility}"`
        });
        break;
      }

      // Match on high item overlap (e.g. 2+ distinct valve items identical)
      if (pItems.length > 0 && mItems.length > 0) {
        const intersection = pItems.filter(i => mItems.includes(i) && i.length >= 10);
        if (intersection.length >= 2 || (pItems.length === 1 && intersection.length === 1 && pItems[0].length >= 15)) {
          // Check date proximity within 60 days
          const pDate = p.enquiryDate ? new Date(p.enquiryDate).getTime() : 0;
          const mDate = m.enquiryDate ? new Date(m.enquiryDate).getTime() : 0;
          const daysDiff = Math.abs(pDate - mDate) / (1000 * 60 * 60 * 24);
          if (daysDiff <= 60) {
            potentialMatches.push({
              pendingDocket: p.docketNumber,
              party: p.partyName,
              type: "LIFECYCLE_PAIR",
              matchedWith: m.docketNumber,
              details: `Same Party & Identical Items (${intersection.length} items matched, diff: ${daysDiff.toFixed(0)} days)`
            });
            break;
          }
        }
      }
    }
  }

  console.log(`Found ${potentialMatches.length} lifecycle pairs with already-matched dockets:`);
  for (const pm of potentialMatches) {
    console.log(` - Pending: ${pm.pendingDocket} -> Matched With: ${pm.matchedWith} (${pm.details})`);
  }

  // STRATEGY 2: Attachment Email Subject match directly with docket_quotation_threads
  // Fetch all threads from docket_quotation_threads
  const allThreads = await prisma.docketQuotationThread.findMany({
    select: { id: true, threadId: true, docketNo: true, subject: true, date: true, bodyPreview: true }
  });

  const attachmentMatches: PotentialMatch[] = [];

  for (const p of pending) {
    for (const a of p.attachments) {
      let extractedTitle = "";

      // Match patterns like:
      // "Gmail - Fwd_ RFQ for DI Valves MACHILIPATNAM PORT Project---Reg.pdf"
      // "G. M. Dalui & Sons Private Limited Mail - Fwd_ Quotation required of expansion bellows...pdf"
      // "FW_ RFQ for Valves for OKDR Project...eml"
      const m1 = a.name.match(/(?:Gmail|Mail)\s*-\s*(?:Fwd_?|Re_?)*\s*(.+?)\.pdf/i);
      const m2 = a.name.match(/(?:FW|RE)\s*[-:_]\s*(.+?)\.(?:eml|pdf|msg)/i);

      if (m1) extractedTitle = m1[1].replace(/_/g, " ").trim();
      else if (m2) extractedTitle = m2[1].replace(/_/g, " ").trim();

      if (extractedTitle && extractedTitle.length >= 10) {
        // Search this title against all threads in memory
        const cleanTitle = extractedTitle.toLowerCase();
        // Extract 3-4 consecutive distinctive words
        const words = cleanTitle.split(/\s+/).filter(w => w.length >= 4);

        for (const t of allThreads) {
          const tSubj = (t.subject || "").toLowerCase();
          if (!tSubj) continue;

          // Check if subject has strong phrase overlap
          let matchCount = 0;
          for (const w of words) {
            if (tSubj.includes(w)) matchCount++;
          }

          if (words.length >= 3 && matchCount >= Math.min(words.length, 3)) {
            attachmentMatches.push({
              pendingDocket: p.docketNumber,
              party: p.partyName,
              type: "ATTACHMENT_SUBJECT_MATCH",
              matchedWith: `Thread ${t.id}`,
              threadId: t.id,
              threadSubject: t.subject || "",
              details: `Extracted: "${extractedTitle}" matched Thread: "${t.subject}"`
            });
            break;
          }
        }
      }
    }
  }

  console.log(`\nFound ${attachmentMatches.length} direct attachment email subject matches:`);
  for (const am of attachmentMatches) {
    console.log(` - Pending: ${am.pendingDocket} -> Thread: ${am.threadId}`);
    console.log(`   ${am.details}`);
  }
}

main().then(() => process.exit(0)).catch(console.error);
