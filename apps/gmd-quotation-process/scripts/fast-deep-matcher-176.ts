import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Fast Deep Matcher for 176 Pending Enquiries starting...");

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
  console.log(`Analyzing ${pending.length} pending enquiries...`);

  // Build target tokens per enquiry
  interface TargetMeta {
    docket: string;
    party: string;
    dateMs: number | null;
    exactTokens: string[];
    numPatterns: RegExp[];
    driveIds: string[];
  }

  const targetMetas: TargetMeta[] = [];

  for (const e of pending) {
    const raw = e.docketNumber.trim();
    const exactTokens = new Set<string>();
    const numPatterns: RegExp[] = [];
    const driveIds = new Set<string>();

    // A. Docket variations
    exactTokens.add(raw.toLowerCase());
    const mGmd00 = raw.match(/^GMD0*(\d+)$/i);
    if (mGmd00) {
      const num = mGmd00[1];
      exactTokens.add(`gmd${num}`);
      exactTokens.add(`gmd ${num}`);
      exactTokens.add(`gmd-${num}`);
      exactTokens.add(`gmd/${num}`);
      numPatterns.push(new RegExp(`(?:docket|quote|rfq|enq|gmd)[\\s\\/\\-:#]*0*${num}\\b`, "i"));
    }

    const mGmdSlash = raw.match(/GMD[\/\-\s]?(?:20)?26[\/\-\s]?27[\/\-\s]?0*(\d+)/i);
    if (mGmdSlash) {
      const num = mGmdSlash[1];
      const intNum = parseInt(num, 10).toString();
      exactTokens.add(`26-27/${num}`);
      exactTokens.add(`26-27/${intNum}`);
      exactTokens.add(`2026-27/${num}`);
      exactTokens.add(`2026-27/${intNum}`);
      exactTokens.add(`gmd/26-27/${num}`);
      exactTokens.add(`gmd/26-27/${intNum}`);
      exactTokens.add(`gmd/2026-27/${num}`);
      exactTokens.add(`gmd/2026-27/${intNum}`);
      exactTokens.add(`gmd-${num}`);
      exactTokens.add(`gmd ${num}`);
      numPatterns.push(new RegExp(`(?:docket|quote|rfq|enq|gmd)[\\s\\/\\-:#]*0*${intNum}\\b`, "i"));
    }

    // B. Contracts
    for (const c of [...e.contractNo, ...e.selectedContractNo]) {
      const clean = c.trim().toLowerCase();
      if (clean.length >= 6) exactTokens.add(clean);
    }

    // C. Project Reference
    if (e.projectReference && e.projectReference.trim().length >= 4) {
      exactTokens.add(e.projectReference.trim().toLowerCase());
    }

    // D. Attachments
    for (const a of e.attachments) {
      // Drive ID
      const mDrive = a.url.match(/[-\w]{25,}/);
      if (mDrive) driveIds.add(mDrive[0].toLowerCase());

      // RFX
      const rfx = a.name.match(/80000\d{5,}/g);
      if (rfx) rfx.forEach(r => exactTokens.add(r.toLowerCase()));

      // RFQ
      const rfq = a.name.match(/RFQ\d{4,}[-\d]*/gi);
      if (rfq) rfq.forEach(r => exactTokens.add(r.toLowerCase()));

      // GeM Bid number
      const gem = a.name.match(/\b\d{7,8}\b/g);
      if (gem) gem.forEach(g => exactTokens.add(g.toLowerCase()));

      // Extracted Gmail Subject
      const gmailMatch = a.name.match(/(?:Gmail|Mail)\s*-\s*(?:Fwd_?|Re_?)*\s*(.+?)\.pdf/i);
      if (gmailMatch) {
        const extracted = gmailMatch[1].replace(/_/g, " ").trim().toLowerCase();
        if (extracted.length >= 12) exactTokens.add(extracted);
      }
    }

    targetMetas.push({
      docket: raw,
      party: e.partyName,
      dateMs: e.enquiryDate ? new Date(e.enquiryDate).getTime() : null,
      exactTokens: Array.from(exactTokens),
      numPatterns,
      driveIds: Array.from(driveIds)
    });
  }

  console.log(`Targets prepared. Starting in-memory scan of docket_quotation_threads...`);

  const matchesByDocket = new Map<string, Array<{ threadId: number; reason: string; subject: string }>>();
  const totalThreads = await prisma.docketQuotationThread.count();
  const BATCH_SIZE = 500;

  for (let offset = 0; offset < totalThreads; offset += BATCH_SIZE) {
    const batch = await prisma.docketQuotationThread.findMany({
      skip: offset,
      take: BATCH_SIZE,
      select: {
        id: true,
        docketNo: true,
        subject: true,
        bodyPreview: true,
        attachNames: true,
        attachLinks: true,
        ocrText: true,
        date: true
      }
    });

    for (const t of batch) {
      const subj = (t.subject || "").toLowerCase();
      const prev = (t.bodyPreview || "").toLowerCase();
      const attNames = (Array.isArray(t.attachNames) ? t.attachNames.join(" ") : "").toLowerCase();
      const attLinks = JSON.stringify(t.attachLinks || {}).toLowerCase();
      const ocr = (t.ocrText || "").slice(0, 15000).toLowerCase();

      const combinedText = `${subj} ${attNames} ${prev} ${ocr}`;

      for (const tm of targetMetas) {
        let matched = false;
        let reason = "";

        // Check Drive IDs
        for (const did of tm.driveIds) {
          if (attLinks.includes(did) || ocr.includes(did)) {
            matched = true;
            reason = `Drive ID: ${did}`;
            break;
          }
        }

        // Check Exact Tokens (contracts, RFX, RFQ, GeM, docket string)
        if (!matched) {
          for (const token of tm.exactTokens) {
            if (combinedText.includes(token)) {
              matched = true;
              reason = `Token: "${token}"`;
              break;
            }
          }
        }

        // Check Num Patterns in subject / attachNames / ocr
        if (!matched) {
          for (const pat of tm.numPatterns) {
            if (pat.test(subj) || pat.test(attNames)) {
              matched = true;
              reason = `Pattern: ${pat}`;
              break;
            }
          }
        }

        if (matched) {
          if (!matchesByDocket.has(tm.docket)) {
            matchesByDocket.set(tm.docket, []);
          }
          matchesByDocket.get(tm.docket)!.push({
            threadId: t.id,
            reason,
            subject: t.subject || ""
          });
        }
      }
    }

    console.log(`Processed ${Math.min(offset + BATCH_SIZE, totalThreads)} / ${totalThreads} threads... Current matches: ${matchesByDocket.size}`);
  }

  console.log(`\n======================================================`);
  console.log(`SCAN COMPLETE!`);
  console.log(`New matches found: ${matchesByDocket.size} / ${pending.length} pending enquiries`);
  console.log(`Remaining truly pending enquiries: ${pending.length - matchesByDocket.size}`);
  console.log(`======================================================\n`);

  for (const [docket, list] of matchesByDocket.entries()) {
    console.log(`Docket: ${docket} (Matches: ${list.length})`);
    list.slice(0, 2).forEach(m => {
      console.log(`  -> Thread ${m.threadId} [${m.reason}]: "${m.subject}"`);
    });
  }
}

main().then(() => process.exit(0)).catch(console.error);
