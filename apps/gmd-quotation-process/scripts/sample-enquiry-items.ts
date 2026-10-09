/**
 * Read-only sampler for the docket item extractor.
 *
 * Prints real `EnquiryItem.itemName` / `quantity` values (the format the
 * extractor must produce) and a few pending threads' mail text (the format it
 * must parse). Used to calibrate `schedular_function/docket-item-parser.ts` and
 * to build its unit-test fixtures.
 *
 * Usage: npx tsx scripts/sample-enquiry-items.ts [limit]
 * Performs no writes.
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const limit = Number(process.argv[2] ?? "60") || 60;

  const itemCount = await prisma.enquiryItem.count();
  console.log(`EnquiryItem rows: ${itemCount}\n`);

  const items = await prisma.enquiryItem.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      itemName: true,
      quantity: true,
      itemType: true,
      moc: true,
      size: true,
      enquiry: { select: { docketNumber: true, partyName: true } },
    },
  });

  console.log(`--- ${items.length} most recent EnquiryItem rows ---`);
  for (const it of items) {
    console.log(
      `${it.enquiry.docketNumber} | qty=${it.quantity.toString()} | "${it.itemName}" | type=${it.itemType ?? "-"} moc=${it.moc ?? "-"} size=${it.size ?? "-"}`,
    );
  }

  const pending = await prisma.docketQuotationThread.findMany({
    where: { pendingDocket: true, docketNo: null },
    orderBy: { date: "desc" },
    take: 5,
    select: {
      id: true,
      subject: true,
      bodyPreview: true,
      attachNames: true,
      ocrText: true,
    },
  });

  console.log(`\n--- ${pending.length} pendingDocket threads (mail text sample) ---`);
  for (const t of pending) {
    console.log(`\n[thread ${t.id}] subject: "${t.subject ?? ""}"`);
    console.log(`attachments: ${JSON.stringify(t.attachNames)}`);
    console.log(`bodyPreview:\n${(t.bodyPreview ?? "").slice(0, 1200)}`);
    console.log(`ocrText:\n${(t.ocrText ?? "").slice(0, 1200)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
