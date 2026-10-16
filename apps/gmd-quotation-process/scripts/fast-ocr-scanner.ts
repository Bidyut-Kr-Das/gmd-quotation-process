import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Starting streaming regex scan across subject, body, attach_names, and OCR text...");

  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      attachments: { select: { url: true } },
    }
  });

  console.log(`Loaded ${enquiries.length} enquiries.`);

  // Lookup map for fast matching:
  // e.g. "2026-27/076" -> "GMD/2026-27/076", "76" -> "GMD/2026-27/076"
  const normalizedToEnq = new Map<string, string>();
  for (const e of enquiries) {
    const raw = e.docketNumber.trim().toUpperCase();
    normalizedToEnq.set(raw, e.docketNumber);

    // If GMD/2026-27/076
    const m = raw.match(/GMD[\/\-\s]?(?:20)?26[\/\-\s]?27[\/\-\s]?0*(\d+)/);
    if (m) {
      const num = m[1];
      normalizedToEnq.set(`26-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`2026-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD/2026-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD/26-27/${num}`, e.docketNumber);
      normalizedToEnq.set(`GMD-2026-27-${num}`, e.docketNumber);
    }

    // If GMD003260
    const m2 = raw.match(/GMD0*(\d+)/);
    if (m2) {
      normalizedToEnq.set(`GMD${m2[1]}`, e.docketNumber);
      normalizedToEnq.set(`GMD00${m2[1]}`, e.docketNumber);
    }
  }

  // Drive File IDs
  const driveIdToDocket = new Map<string, string>();
  for (const e of enquiries) {
    for (const a of e.attachments) {
      const m = a.url.match(/[-\w]{25,}/);
      if (m) driveIdToDocket.set(m[0], e.docketNumber);
    }
  }

  const threadToDockets = new Map<number, Set<string>>();
  const totalThreads = await prisma.docketQuotationThread.count();
  const BATCH_SIZE = 500;

  console.log(`Total threads to process: ${totalThreads} in batches of ${BATCH_SIZE}`);

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

      const searchHead = `${dNo}\n${subj}\n${atts}\n${prev}\n${ocr}`;

      // 1. Direct regex for GMD
      const gmdMatches = searchHead.match(/GMD[\/\-\s]*(?:20)?26[\/\-\s]*27[\/\-\s]*\d+|GMD0*\d+/gi) || [];
      for (const gm of gmdMatches) {
        const clean = gm.replace(/\s+/g, "").toUpperCase();
        // Check in lookup
        for (const [normKey, docket] of normalizedToEnq.entries()) {
          if (clean === normKey || clean.includes(normKey)) {
            if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
            threadToDockets.get(t.id)!.add(docket);
          }
        }
      }

      // 2. Drive file IDs in attachLinks or OCR
      for (const [driveId, docket] of driveIdToDocket.entries()) {
        if (linksStr.includes(driveId) || ocr.includes(driveId)) {
          if (!threadToDockets.has(t.id)) threadToDockets.set(t.id, new Set());
          threadToDockets.get(t.id)!.add(docket);
        }
      }

      // 3. If thread already had docketNo, preserve it
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
    console.log(`Processed ${processed} / ${totalThreads} threads...`);
  }

  // Count unique enquiries matched
  const allMatchedEnquiries = new Set<string>();
  for (const [_, dockets] of threadToDockets.entries()) {
    for (const d of dockets) allMatchedEnquiries.add(d);
  }

  console.log(`\n==========================================`);
  console.log(`SCAN COMPLETE!`);
  console.log(`Total threads with matched dockets: ${threadToDockets.size}`);
  console.log(`Total unique enquiries matched (Emails Found): ${allMatchedEnquiries.size} / ${enquiries.length}`);
  console.log(`Action Pending remaining: ${enquiries.length - allMatchedEnquiries.size}`);
}

main().then(() => process.exit(0)).catch(console.error);
