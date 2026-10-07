import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Starting Execution of Smart Backfill for docket_quotation_threads...");

  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      contractNo: true,
      selectedContractNo: true,
      projectReference: true,
      attachments: { select: { url: true, name: true } },
      items: { select: { itemName: true } },
    }
  });

  console.log(`Loaded ${enquiries.length} enquiries.`);

  // Lookup map: Normalized docket strings -> Enquiry docketNumber
  const normalizedToEnq = new Map<string, string>();
  for (const e of enquiries) {
    const raw = e.docketNumber.trim().toUpperCase();
    normalizedToEnq.set(raw, e.docketNumber);

    const m = raw.match(/GMD[\/\-\s]?(?:20)?26[\/\-\s]?27[\/\-\s]?0*(\d+)/);
    if (m) {
      const num = m[1];
      normalizedToEnq.set(`26-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`2026-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD/2026-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD/26-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD-2026-27-${num}`, e.docketNumber);
    }
    const m2 = raw.match(/GMD0*(\d+)/);
    if (m2) {
      normalizedToEnq.set(`GMD${m2[1]}`, e.docketNumber);
      normalizedToEnq.set(`GMD00${m2[1]}`, e.docketNumber);
    }
  }

  // Drive File IDs lookup
  const driveIdToDocket = new Map<string, string>();
  for (const e of enquiries) {
    for (const a of e.attachments) {
      const m = a.url.match(/[-\w]{25,}/);
      if (m) driveIdToDocket.set(m[0], e.docketNumber);
    }
  }

  // Tender / GeM lookup
  const tenderLookup: Array<{ docket: string; regex: RegExp }> = [];
  for (const e of enquiries) {
    const allText = `${e.contractNo.join(" ")} ${e.selectedContractNo.join(" ")} ${e.projectReference || ""} ${e.attachments.map(a => a.name).join(" ")} ${e.items.map(i => i.itemName).slice(0, 5).join(" ")}`;
    const gems = allText.match(/GEM[\/\-_ ]\d{4}[\/\-_ ][A-Z][\/\-_ ]\d+/gi) || [];
    for (const g of gems) {
      tenderLookup.push({ docket: e.docketNumber, regex: new RegExp(g.replace(/[\/\-_ ]/g, "."), "i") });
    }
    const tids = allText.match(/TID\s*[:#-]?\s*(\d{5,})/gi) || [];
    for (const tid of tids) {
      const num = tid.replace(/\D/g, "");
      if (num.length >= 5) {
        tenderLookup.push({ docket: e.docketNumber, regex: new RegExp(`\\b${num}\\b`, "i") });
      }
    }
  }

  // Party Name Lookup with Dates
  const partyLookup: Array<{
    docket: string;
    keywords: string[];
    date: number | null;
  }> = [];

  const INTERNAL_PATTERNS = [/laser/i, /gmdalui/i, /uicwires/i, /protul/i];
  function isInternalParty(name: string): boolean {
    return INTERNAL_PATTERNS.some(p => p.test(name));
  }

  for (const e of enquiries) {
    if (isInternalParty(e.partyName)) continue; // STRICTLY SKIP INTERNAL PARTY NAMES (e.g. Laser Power & Infra)
    const clean = e.partyName.replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt|Private)\b/gi, "").trim();
    const words = clean.split(/\s+/).filter(w => w.length >= 4);
    if (words.length > 0) {
      partyLookup.push({
        docket: e.docketNumber,
        keywords: words.map(w => w.toLowerCase()),
        date: e.enquiryDate ? new Date(e.enquiryDate).getTime() : null,
      });
    }
  }

  const threadToDockets = new Map<number, Set<string>>();
  const totalThreads = await prisma.docketQuotationThread.count();
  const BATCH_SIZE = 500;

  let processed = 0;
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
        sender: true,
        date: true,
      }
    });

    for (const t of batch) {
      const dNo = (t.docketNo || "").trim().toUpperCase();
      const subj = t.subject || "";
      const prev = t.bodyPreview || "";
      const atts = Array.isArray(t.attachNames) ? t.attachNames.join(" ") : "";
      const ocr = (t.ocrText || "").slice(0, 10000);
      const linksStr = JSON.stringify(t.attachLinks || {});
      const sender = (t.sender || "").toLowerCase();
      const tTime = t.date ? new Date(t.date).getTime() : 0;

      const fullScanText = `${dNo}\n${subj}\n${atts}\n${prev}\n${ocr}`;

      // 1. Direct Docket Number Regex (subject, bodyPreview, ocr, attachNames)
      const gmdMatches = fullScanText.match(/GMD[\/\-\s]*(?:20)?26[\/\-\s]*27[\/\-\s]*\d+|GMD0*\d+/gi) || [];
      for (const gm of gmdMatches) {
        const clean = gm.replace(/\s+/g, "").toUpperCase();
        for (const [normKey, docket] of normalizedToEnq.entries()) {
          if (clean === normKey || clean.includes(normKey)) {
            if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
            threadToDockets.get(t.id)!.add(docket);
          }
        }
      }

      // 2. Drive Attachment ID
      for (const [driveId, docket] of driveIdToDocket.entries()) {
        if (linksStr.includes(driveId) || ocr.includes(driveId)) {
          if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
          threadToDockets.get(t.id)!.add(docket);
        }
      }

      // 3. Tender / GeM Bid
      for (const tl of tenderLookup) {
        if (tl.regex.test(fullScanText)) {
          if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
          threadToDockets.get(t.id)!.add(tl.docket);
        }
      }

      // 4. Party Name + Docket/Quote intent within 6 days
      const subjLower = subj.toLowerCase();
      const isQuoteOrDocket =
        subjLower.includes("docket") ||
        subjLower.includes("quotation") ||
        subjLower.includes("rate") ||
        subjLower.includes("rfq") ||
        subjLower.includes("enquiry") ||
        subjLower.includes("valve");

      if (isQuoteOrDocket && tTime) {
        const checkArea = `${subjLower} ${prev.toLowerCase()}`;
        for (const pl of partyLookup) {
          if (!pl.date) continue;
          const diff = Math.abs(tTime - pl.date) / (1000 * 60 * 60 * 24);
          if (diff <= 6) {
            const firstWord = pl.keywords[0];
            if (firstWord && checkArea.includes(firstWord)) {
              if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
              threadToDockets.get(t.id)!.add(pl.docket);
            }
          }
        }
      }

      // 5. Existing docketNo
      if (dNo) {
        for (const e of enquiries) {
          if (dNo === e.docketNumber.toUpperCase()) {
            if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
            threadToDockets.get(t.id)!.add(e.docketNumber);
          }
        }
      }
    }

    processed += batch.length;
  }

  console.log(`Matching phase complete! Updating ${threadToDockets.size} threads in database...`);

  // Update threads in batches of 100
  let updatedCount = 0;
  const entries = Array.from(threadToDockets.entries());

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    await Promise.all(
      chunk.map(async ([threadId, dockets]) => {
        // Fetch current docketNo
        const current = await prisma.docketQuotationThread.findUnique({
          where: { id: threadId },
          select: { docketNo: true }
        });

        const currentDockets = (current?.docketNo || "")
          .split(",")
          .map(d => d.trim())
          .filter(Boolean);

        const merged = Array.from(new Set([...Array.from(dockets), ...currentDockets]));
        let newDocketStr = merged.join(", ");
        if (newDocketStr.length > 250) {
          newDocketStr = newDocketStr.slice(0, 250);
        }

        if (newDocketStr && newDocketStr !== current?.docketNo) {
          await prisma.docketQuotationThread.update({
            where: { id: threadId },
            data: { docketNo: newDocketStr }
          });
          updatedCount++;
        }
      })
    );
    console.log(`Updated ${Math.min(i + 100, entries.length)} / ${entries.length} threads...`);
  }

  console.log(`\n======================================================`);
  console.log(`SMART BACKFILL COMPLETED SUCCESSFULLY!`);
  console.log(`Total threads updated in database: ${updatedCount}`);
}

main().then(() => process.exit(0)).catch(console.error);
