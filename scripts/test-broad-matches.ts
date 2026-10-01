import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      contractNo: true,
      projectReference: true,
      utility: true,
      items: { select: { itemName: true } },
      attachments: { select: { name: true, url: true } }
    }
  });

  // Identify which ones are the 211 currently unmatched in comprehensive-linker
  // Let's test how many threads have party names or party email addresses!
  // In docket_quotation_threads:
  // Let's check sender, toDetails, ccDetails, subject, bodyPreview
  const allThreads = await prisma.docketQuotationThread.findMany({
    select: {
      id: true,
      docketNo: true,
      subject: true,
      sender: true,
      toDetails: true,
      ccDetails: true,
      bodyPreview: true,
      date: true,
    }
  });

  console.log(`Loaded ${allThreads.length} threads.`);

  let matchedAnywhere = 0;
  const matchDetails: Array<{ docket: string; party: string; threadId: number; reason: string }> = [];

  for (const e of enquiries) {
    const raw = e.docketNumber.trim();
    // Normalize docket (e.g. GMD/2026-27/431 -> 431)
    const numMatch = raw.match(/\d+$/);
    const num = numMatch ? numMatch[0] : "";
    const cleanParty = e.partyName.replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt)\b/gi, "").trim();
    const partyFirstWord = cleanParty.split(/\s+/).find(w => w.length >= 4) || "";

    // Search in all threads
    let found = false;
    for (const t of allThreads) {
      const s = (t.subject || "").toLowerCase();
      const b = (t.bodyPreview || "").toLowerCase();
      const snd = (t.sender || "").toLowerCase();
      const to = JSON.stringify(t.toDetails || {}).toLowerCase();
      const cc = JSON.stringify(t.ccDetails || {}).toLowerCase();
      const dNo = (t.docketNo || "").toLowerCase();

      // Check if docketNo or subject has raw docket
      if (dNo === raw.toLowerCase() || s.includes(raw.toLowerCase()) || b.includes(raw.toLowerCase())) {
        matchDetails.push({ docket: raw, party: e.partyName, threadId: t.id, reason: "Direct docket match" });
        found = true;
        break;
      }

      // Check if party name matches AND thread is about valves / quotation / docket / enquiry
      if (partyFirstWord && (s.includes(partyFirstWord.toLowerCase()) || snd.includes(partyFirstWord.toLowerCase()) || to.includes(partyFirstWord.toLowerCase()) || cc.includes(partyFirstWord.toLowerCase()))) {
        // Date match within 7 days
        if (e.enquiryDate && t.date) {
          const diff = Math.abs(new Date(e.enquiryDate).getTime() - new Date(t.date).getTime()) / (1000 * 60 * 60 * 24);
          if (diff <= 7) {
            matchDetails.push({ docket: raw, party: e.partyName, threadId: t.id, reason: `Party "${partyFirstWord}" matched within ${diff.toFixed(1)} days` });
            found = true;
            break;
          }
        }
      }
    }

    if (found) matchedAnywhere++;
  }

  console.log(`\n==========================================`);
  console.log(`TOTAL ENQUIRIES MATCHED (Docket OR Party + Date within 7d): ${matchedAnywhere} / ${enquiries.length}`);
  console.log(`Unmatched remaining: ${enquiries.length - matchedAnywhere}`);
}

main().then(() => process.exit(0)).catch(console.error);
