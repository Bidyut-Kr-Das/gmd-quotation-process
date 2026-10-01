import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Starting Comprehensive Deep Matcher for remaining 176 enquiries...");

  // 1. Fetch all enquiries
  const enquiries = await prisma.enquiry.findMany({
    orderBy: { docketNumber: "asc" },
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      contractNo: true,
      selectedContractNo: true,
      projectReference: true,
      attachments: { select: { name: true, url: true } },
      items: { select: { itemName: true } }
    }
  });

  // 2. Currently assigned threads
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
  console.log(`Currently Pending: ${pending.length} enquiries.`);

  // Build target queries for each pending enquiry
  interface EnquiryTarget {
    docket: string;
    party: string;
    enqDate: Date | null;
    searchTokens: string[];
    reasons: string[];
  }

  const targets: EnquiryTarget[] = [];

  for (const e of pending) {
    const tokens = new Set<string>();
    const reasons: string[] = [];

    // A. Contract numbers
    for (const c of [...e.contractNo, ...e.selectedContractNo]) {
      const clean = c.trim();
      if (clean.length >= 6) {
        tokens.add(clean);
        reasons.push(`Contract: ${clean}`);
      }
    }

    // B. Project reference
    if (e.projectReference && e.projectReference.trim().length >= 4) {
      tokens.add(e.projectReference.trim());
      reasons.push(`ProjRef: ${e.projectReference.trim()}`);
    }

    // C. Attachment Names - extract RFX, RFQ, TID, GeM, or subjects
    for (const a of e.attachments) {
      const name = a.name;

      // Extract numbers like RFX No 8000054206 or 8000054726
      const rfx = name.match(/80000\d{5,}/g);
      if (rfx) {
        rfx.forEach(r => { tokens.add(r); reasons.push(`RFX: ${r}`); });
      }

      // Extract RFQ like RFQ2026-270540
      const rfq = name.match(/RFQ\d{4,}[-\d]*/gi);
      if (rfq) {
        rfq.forEach(r => { tokens.add(r); reasons.push(`RFQ: ${r}`); });
      }

      // Extract GeM IDs like 9611095 or GEM-Bidding-9611095
      const gem = name.match(/\b\d{7,8}\b/g);
      if (gem) {
        gem.forEach(g => { tokens.add(g); reasons.push(`GeM/ID: ${g}`); });
      }

      // Extract subject from "Gmail - Fwd_ ..." or "G. M. Dalui & Sons Private Limited Mail - ..."
      const gmailMatch = name.match(/(?:Gmail|Mail)\s*-\s*(?:Fwd_?|Re_?)*\s*(.+?)\.pdf/i);
      if (gmailMatch) {
        const extractedSubj = gmailMatch[1].replace(/_/g, " ").trim();
        if (extractedSubj.length >= 10) {
          // Take distinctive phrases of 4+ words
          tokens.add(extractedSubj);
          reasons.push(`Extracted Subject: "${extractedSubj}"`);
        }
      }
    }

    if (tokens.size > 0) {
      targets.push({
        docket: e.docketNumber,
        party: e.partyName,
        enqDate: e.enquiryDate ? new Date(e.enquiryDate) : null,
        searchTokens: Array.from(tokens),
        reasons
      });
    }
  }

  console.log(`Generated extracted search tokens for ${targets.length} pending enquiries.`);

  // Search each token across docket_quotation_threads
  const newMatches = new Map<string, Array<{ threadId: number; token: string; subject: string; date: string }>>();

  for (const t of targets) {
    for (const token of t.searchTokens) {
      // Ignore very generic words
      if (token.length < 5) continue;

      const results = await prisma.docketQuotationThread.findMany({
        where: {
          OR: [
            { subject: { contains: token, mode: "insensitive" } },
            { bodyPreview: { contains: token, mode: "insensitive" } },
            { attachNames: { string_contains: token } },
            { ocrText: { contains: token, mode: "insensitive" } }
          ]
        },
        select: { id: true, subject: true, date: true, docketNo: true }
      });

      if (results.length > 0) {
        if (!newMatches.has(t.docket)) {
          newMatches.set(t.docket, []);
        }
        for (const r of results) {
          newMatches.get(t.docket)!.push({
            threadId: r.id,
            token,
            subject: r.subject || "",
            date: r.date?.toISOString().split("T")[0] || ""
          });
        }
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`NEW MATCHES FOUND FOR PENDING ENQUIRIES:`);
  console.log(`Total previously pending enquiries matched: ${newMatches.size}`);
  console.log(`======================================================\n`);

  for (const [docket, matches] of newMatches.entries()) {
    console.log(`Docket: ${docket} -> ${matches.length} matching threads found:`);
    for (const m of matches.slice(0, 3)) {
      console.log(`  * Thread ID ${m.threadId} (Date: ${m.date}) | Token: "${m.token}"`);
      console.log(`    Subject: "${m.subject}"`);
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
