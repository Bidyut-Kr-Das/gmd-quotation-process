import "dotenv/config";
import { prisma } from "../lib/prisma";

function normalizeForSearch(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

async function main() {
  console.log("Starting Robust Normalized Quotation Detection (Attachment + OCR fallback)...");

  // 1. Fetch all enquiries
  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, docketNumber: true, partyName: true }
  });

  interface DocketPattern {
    raw: string;
    normFull: string;
    normShort: string | null;
    cleanNum: string;
    regex: RegExp;
  }

  const docketPatterns: DocketPattern[] = enquiries.map((e) => {
    const raw = e.docketNumber.trim();
    const cleanNum = raw
      .replace(/^GMD[\/\-\s]?(?:20)?26[\/\-\s]?27[\/\-\s]?0*/i, "")
      .replace(/^GMD0*/i, "");

    const normFull = normalizeForSearch(raw); // e.g. "gmd202627416" or "gmd003248"
    let normShort: string | null = null;
    if (cleanNum && cleanNum.length >= 2) {
      normShort = `2627${cleanNum}`;
    }

    // Flexible regex allowing underscores, slashes, dashes, spaces, or nothing
    const regex = new RegExp(
      `(?:^|[^0-9a-zA-Z])(?:GMD[\\/\\-_\\s.]*)?(?:(?:20)?26[\\/\\-_\\s.]*27[\\/\\-_\\s.]*|0+)?${cleanNum}(?:[^0-9a-zA-Z]|$)`,
      "i"
    );

    return { raw, normFull, normShort, cleanNum, regex };
  });

  const totalThreads = await prisma.docketQuotationThread.count({
    where: { docketNo: { not: null } }
  });

  console.log(`Analyzing ${totalThreads} threads with linked dockets...`);

  const BATCH_SIZE = 300;
  let quoteAttachCount = 0;
  let quoteOcrCount = 0;
  let updatedCount = 0;

  for (let offset = 0; offset < totalThreads; offset += BATCH_SIZE) {
    const batch = await prisma.docketQuotationThread.findMany({
      where: { docketNo: { not: null } },
      skip: offset,
      take: BATCH_SIZE,
      select: {
        id: true,
        docketNo: true,
        attachNames: true,
        ocrText: true,
        actionTag: true,
        matchReasons: true,
      }
    });

    for (const t of batch) {
      if (!t.docketNo) continue;
      const linkedDockets = t.docketNo
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      const rawAtts = Array.isArray(t.attachNames) ? t.attachNames.join(" ") : "";
      const normAtts = normalizeForSearch(rawAtts);

      const rawOcr = (t.ocrText || "").slice(0, 25000);
      const normOcr = normalizeForSearch(rawOcr);

      let detectedMethod: "ATTACH" | "OCR" | "NONE" = "NONE";
      const matchedDocketsInQuote: string[] = [];

      for (const dKey of linkedDockets) {
        const pattern = docketPatterns.find((p) => p.raw.toLowerCase() === dKey);
        if (!pattern) continue;

        // 1. Primary Check: Attachment Name contains Docket
        const inAttach =
          normAtts.includes(pattern.normFull) ||
          (pattern.normShort ? normAtts.includes(pattern.normShort) : false) ||
          pattern.regex.test(rawAtts);

        if (inAttach) {
          detectedMethod = "ATTACH";
          matchedDocketsInQuote.push(pattern.raw);
          break;
        }

        // 2. Fallback Check: OCR text contains Docket
        const inOcr =
          normOcr.includes(pattern.normFull) ||
          (pattern.normShort ? normOcr.includes(pattern.normShort) : false) ||
          pattern.regex.test(rawOcr);

        if (inOcr) {
          detectedMethod = "OCR";
          matchedDocketsInQuote.push(pattern.raw);
          break;
        }
      }

      let newActionTag = t.actionTag || "";
      if (detectedMethod === "ATTACH") {
        newActionTag = "QUOTE_SENT_ATTACH";
        quoteAttachCount++;
      } else if (detectedMethod === "OCR") {
        newActionTag = "QUOTE_SENT_OCR";
        quoteOcrCount++;
      } else {
        newActionTag = "THREAD_LINKED";
      }

      if (newActionTag !== t.actionTag) {
        await prisma.docketQuotationThread.update({
          where: { id: t.id },
          data: {
            actionTag: newActionTag,
            matchReasons:
              matchedDocketsInQuote.length > 0
                ? `Quote detected via ${detectedMethod}: ${matchedDocketsInQuote.join(", ")}`
                : t.matchReasons,
          }
        });
        updatedCount++;
      }
    }

    console.log(`Processed ${Math.min(offset + BATCH_SIZE, totalThreads)} / ${totalThreads}... (Attach: ${quoteAttachCount}, OCR: ${quoteOcrCount})`);
  }

  console.log(`\n======================================================`);
  console.log(`NORMALIZED INDEXING COMPLETED!`);
  console.log(`Threads with Quote in Attachment Name: ${quoteAttachCount}`);
  console.log(`Threads with Quote in OCR Text (Fallback): ${quoteOcrCount}`);
  console.log(`Total Quote Sent Threads: ${quoteAttachCount + quoteOcrCount}`);
  console.log(`Database rows updated: ${updatedCount}`);
  console.log(`======================================================`);
}

main().then(() => process.exit(0)).catch(console.error);
