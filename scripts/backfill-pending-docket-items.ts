/**
 * Backfill items onto the existing auto-created "pending" dockets.
 *
 * Targets every `Enquiry` with ZERO items that has a source
 * `DocketQuotationThread` (matched by a docket number token in `thread.docketNo`).
 * For each, the same extraction pipeline as the `docket-creation` job runs over
 * the thread's mail content (bodies + attachments) and the extracted
 * `{ itemName, quantity }` pairs are inserted as `EnquiryItem` rows.
 *
 * Idempotent: a docket that already has any item is not in the target set.
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-pending-docket-items.ts
 *   npx tsx scripts/backfill-pending-docket-items.ts --apply
 *   npx tsx scripts/backfill-pending-docket-items.ts --no-attachments --apply
 *   npx tsx scripts/backfill-pending-docket-items.ts --limit=50 --apply
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { extractDocketItems } from "@/schedular_function/docket-item-extraction";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ATTACHMENTS = !args.includes("--no-attachments");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

const SEP = "=".repeat(74);

/** docketNo may hold several comma-separated numbers; index every token. */
function docketTokens(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

async function main() {
  console.log(`\n=== BACKFILL PENDING-DOCKET ITEMS (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`Attachments: ${ATTACHMENTS ? "on" : "off"} | AI fallback: ${process.env.AI_FALLBACK_ENABLED === "true" ? "on" : "off"}`);
  console.log(SEP);

  const blank = await prisma.enquiry.findMany({
    where: { items: { none: {} } },
    select: { id: true, docketNumber: true, partyName: true },
  });
  const targets = LIMIT > 0 ? blank.slice(0, LIMIT) : blank;

  // Lightweight pass: build docket token -> thread id from every thread.
  const lightThreads = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { not: null } },
    select: { id: true, docketNo: true },
  });
  const threadIdByDocket = new Map<string, number>();
  for (const t of lightThreads) {
    for (const token of docketTokens(t.docketNo)) {
      if (!threadIdByDocket.has(token)) threadIdByDocket.set(token, t.id);
    }
  }

  const matchedIds = Array.from(
    new Set(targets.map((e) => threadIdByDocket.get(e.docketNumber)).filter((v): v is number => v !== undefined)),
  );
  const threads = await prisma.docketQuotationThread.findMany({
    where: { id: { in: matchedIds } },
    select: {
      id: true,
      subject: true,
      body: true,
      bodyPreview: true,
      ocrText: true,
      attachNames: true,
      attachLinks: true,
    },
  });
  const threadById = new Map(threads.map((t) => [t.id, t]));

  let noThread = 0;
  let withItems = 0;
  let withoutItems = 0;
  let itemsTotal = 0;
  let parserHits = 0;
  let aiFallbacks = 0;
  let attachmentFailures = 0;
  const failures: string[] = [];

  for (const e of targets) {
    const threadId = threadIdByDocket.get(e.docketNumber);
    const t = threadId !== undefined ? threadById.get(threadId) : undefined;
    if (!t) {
      noThread++;
      continue;
    }

    try {
      const result = await extractDocketItems({
        subject: t.subject,
        body: t.body,
        bodyPreview: t.bodyPreview,
        ocrText: t.ocrText,
        attachNames: ATTACHMENTS ? t.attachNames : undefined,
        attachLinks: ATTACHMENTS ? t.attachLinks : undefined,
      });

      itemsTotal += result.items.length;
      attachmentFailures += result.attachmentFailures;
      if (result.source === "parser") parserHits++;
      if (result.aiUsed) aiFallbacks++;

      if (result.items.length === 0) {
        withoutItems++;
        console.log(`${APPLY ? "[APPLY]" : "[PLAN] "} ${e.docketNumber.padEnd(20)} items=0 (nothing extracted)`);
        continue;
      }

      withItems++;
      console.log(
        `${APPLY ? "[APPLY]" : "[PLAN] "} ${e.docketNumber.padEnd(20)} items=${result.items.length} (${result.source})  ${e.partyName}`,
      );
      for (const it of result.items.slice(0, 8)) {
        console.log(`           - ${it.quantity} x ${it.itemName}`);
      }
      if (result.items.length > 8) console.log(`           ... +${result.items.length - 8} more`);

      if (!APPLY) continue;

      await prisma.enquiryItem.createMany({
        data: result.items.map((it, index) => ({
          enquiryId: e.id,
          position: index,
          itemName: it.itemName,
          quantity: it.quantity,
          erpItemCode: null,
        })),
      });
    } catch (err) {
      failures.push(`${e.docketNumber}: ${(err as Error).message}`);
      console.log(`           FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\n${SEP}`);
  console.log(`Blank dockets scanned         : ${targets.length}`);
  console.log(`  no source thread            : ${noThread}`);
  console.log(`  ${APPLY ? "filled" : "would fill"} with items        : ${withItems}`);
  console.log(`  nothing extracted           : ${withoutItems}`);
  console.log(`  items ${APPLY ? "written" : "planned"}               : ${itemsTotal}`);
  console.log(`  parser hits / AI fallbacks  : ${parserHits} / ${aiFallbacks}`);
  if (attachmentFailures) console.log(`  attachment read failures    : ${attachmentFailures}`);
  if (failures.length) console.log(`  failures                    : ${failures.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN. Nothing was written. Re-run with --apply to insert items.`);
  }
}

main()
  .catch((e) => {
    console.error("\n[backfill-pending-docket-items] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
