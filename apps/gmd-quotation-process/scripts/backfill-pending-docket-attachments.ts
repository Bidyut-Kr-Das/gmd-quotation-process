/**
 * Backfill the mail attachments + snapshot PDF onto the auto-created blank
 * dockets that were made before this feature existed.
 *
 * For each enquiry with ZERO items that has a source DocketQuotationThread
 * (matched by thread.docketNo == enquiry.docketNumber):
 *   - attach the thread's file attachments (attach_names / attach_links, linked
 *     as-is; names without a link are skipped);
 *   - generate a mail-snapshot PDF and upload it to Google Drive, attaching it.
 *
 * Idempotent: a docket that already has any attachment is skipped.
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-pending-docket-attachments.ts
 *   npx tsx scripts/backfill-pending-docket-attachments.ts --apply
 *   npx tsx scripts/backfill-pending-docket-attachments.ts --no-snapshot --apply
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { parseThreadAttachments } from "@/lib/docketSnapshot";
import { buildSnapshotAttachment } from "@/lib/docketSnapshotPdf";
import { extractEmailsFromValue } from "@/lib/enquiryEmailParty";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SNAPSHOT = !args.includes("--no-snapshot");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

const SEP = "=".repeat(74);

async function main() {
  console.log(`\n=== BACKFILL PENDING-DOCKET ATTACHMENTS (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`Snapshot PDF: ${SNAPSHOT ? "on" : "off"}`);
  console.log(SEP);

  const blank = await prisma.enquiry.findMany({
    where: { items: { none: {} } },
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      _count: { select: { attachments: true } },
    },
  });
  const targets = LIMIT > 0 ? blank.slice(0, LIMIT) : blank;

  const threads = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { in: targets.map((t) => t.docketNumber) } },
    select: {
      docketNo: true,
      subject: true,
      body: true,
      bodyPreview: true,
      sender: true,
      toDetails: true,
      ccDetails: true,
      attachNames: true,
      attachLinks: true,
    },
  });
  const threadByDocket = new Map(threads.map((t) => [t.docketNo, t]));

  let withAttachments = 0;
  let noThread = 0;
  let planned = 0;
  const failures: string[] = [];

  for (const e of targets) {
    if (e._count.attachments > 0) {
      withAttachments++;
      continue;
    }
    const t = threadByDocket.get(e.docketNumber);
    if (!t) {
      noThread++;
      continue;
    }

    const files = parseThreadAttachments(t.attachNames, t.attachLinks);
    console.log(
      `${APPLY ? "[APPLY]" : "[PLAN] "} ${e.docketNumber.padEnd(20)} files=${files.length}${SNAPSHOT ? " + snapshot" : ""}`,
    );
    for (const f of files) console.log(`           - ${f.name}`);

    if (!APPLY) {
      planned++;
      continue;
    }

    try {
      const rows: { name: string; url: string; type: string | null; size: number | null }[] =
        files.map((f) => ({ name: f.name, url: f.url, type: f.type, size: null }));

      if (SNAPSHOT) {
        try {
          const snapshot = await buildSnapshotAttachment({
            docketNumber: e.docketNumber,
            partyName: e.partyName,
            subject: t.subject,
            sender: t.sender,
            to: extractEmailsFromValue(t.toDetails).join(", "),
            cc: extractEmailsFromValue(t.ccDetails).join(", "),
            body: t.body || t.bodyPreview,
            attachments: files.map((f) => ({ name: f.name, url: f.url })),
          });
          rows.push({ name: snapshot.name, url: snapshot.url, type: snapshot.type, size: snapshot.size });
        } catch (snapErr) {
          console.log(`           snapshot FAILED (files still attached): ${(snapErr as Error).message}`);
        }
      }

      if (rows.length > 0) {
        await prisma.attachment.createMany({
          data: rows.map((r) => ({ enquiryId: e.id, ...r })),
        });
      }
      planned++;
    } catch (err) {
      failures.push(`${e.docketNumber}: ${(err as Error).message}`);
      console.log(`           FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\n${SEP}`);
  console.log(`Blank dockets scanned        : ${targets.length}`);
  console.log(`  already had attachments    : ${withAttachments}`);
  console.log(`  no source thread           : ${noThread}`);
  console.log(`  ${APPLY ? "processed" : "would process"}              : ${planned}`);
  if (failures.length) console.log(`  failures                   : ${failures.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN. Nothing was written. Re-run with --apply to attach.`);
  }
}

main()
  .catch((e) => {
    console.error("\n[backfill-pending-docket-attachments] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
