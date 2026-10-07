/**
 * Tidy up the auto-created "pending" dockets (header-only enquiries, no items).
 *
 * Rules:
 *  - Only enquiries with ZERO items are ever touched.
 *  - Each blank docket is linked back to its source DocketQuotationThread by
 *    matching thread.docketNo == enquiry.docketNumber.
 *  - Mails dated BEFORE the cutoff (default 2026-09-01) -> the blank docket is
 *    DELETED. The source thread is left stamped (docketNo kept, pendingDocket
 *    false), so the old docket is never recreated.
 *  - Mails on/after the cutoff -> keep the docket and fill its blank
 *    `emailAddress` from the source thread's external sender/to/cc emails.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/fix-pending-dockets.ts
 *   npx tsx scripts/fix-pending-dockets.ts --apply
 *   npx tsx scripts/fix-pending-dockets.ts --since=2026-09-01 --apply
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { threadPreferredEmails } from "@/lib/pendingDocketMaterializer";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SINCE = new Date(
  args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "2026-09-01T00:00:00.000Z",
);

const SEP = "=".repeat(74);
const short = (s: string | null | undefined, n = 46) => {
  const v = String(s ?? "").trim();
  return v.length > n ? v.slice(0, n - 1) + "\u2026" : v || "-";
};

async function main() {
  console.log(`\n=== FIX PENDING DOCKETS (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`Cutoff (keep mails on/after): ${SINCE.toISOString().slice(0, 10)}`);
  console.log(SEP);

  const blank = await prisma.enquiry.findMany({
    where: { items: { none: {} } },
    select: { id: true, docketNumber: true, partyName: true, emailAddress: true },
  });
  const threads = await prisma.docketQuotationThread.findMany({
    where: { docketNo: { in: blank.map((b) => b.docketNumber) } },
    select: { docketNo: true, date: true, subCategory: true, sender: true, toDetails: true, ccDetails: true },
  });
  const threadByDocket = new Map(threads.map((t) => [t.docketNo, t]));

  const toDelete: { id: string; docketNumber: string; partyName: string; date: Date | null }[] = [];
  const toFill: { id: string; docketNumber: string; emailAddress: string; date: Date | null }[] = [];
  let noThread = 0;
  let alreadyHasEmail = 0;

  for (const e of blank) {
    const t = threadByDocket.get(e.docketNumber);
    if (!t) {
      noThread++;
      continue;
    }
    const date = t.date ?? null;
    if (date && date < SINCE) {
      toDelete.push({ id: e.id, docketNumber: e.docketNumber, partyName: e.partyName, date });
      continue;
    }
    const emails = threadPreferredEmails(t).join(", ");
    if (emails && !(e.emailAddress && e.emailAddress.trim())) {
      toFill.push({ id: e.id, docketNumber: e.docketNumber, emailAddress: emails, date });
    } else if (e.emailAddress && e.emailAddress.trim()) {
      alreadyHasEmail++;
    }
  }

  console.log(`Blank dockets scanned            : ${blank.length}`);
  console.log(`  no source thread                : ${noThread}`);
  console.log(`  DELETE (mail before cutoff)     : ${toDelete.length}`);
  console.log(`  FILL email (kept)               : ${toFill.length}`);
  console.log(`  already have an email (kept)    : ${alreadyHasEmail}`);

  console.log(`\n--- DELETE (${toDelete.length}) ---`);
  for (const d of toDelete) {
    console.log(`  ${d.docketNumber.padEnd(20)} ${d.date ? d.date.toISOString().slice(0, 10) : "?"}  ${short(d.partyName)}`);
  }

  console.log(`\n--- FILL EMAIL (${toFill.length}) ---`);
  for (const f of toFill) {
    console.log(`  ${f.docketNumber.padEnd(20)} ${f.date ? f.date.toISOString().slice(0, 10) : "?"}  -> ${short(f.emailAddress, 60)}`);
  }

  if (!APPLY) {
    console.log(`\n${SEP}`);
    console.log("DRY RUN. Nothing was written. Re-run with --apply to delete + fill.");
    return;
  }

  console.log(`\n${SEP}\nAPPLYING...\n`);
  let deleted = 0;
  let filled = 0;

  for (const d of toDelete) {
    try {
      await prisma.enquiry.delete({ where: { id: d.id } });
      deleted++;
    } catch (e) {
      console.log(`  DELETE FAILED ${d.docketNumber}: ${(e as Error).message}`);
    }
  }

  for (const f of toFill) {
    try {
      await prisma.enquiry.update({ where: { id: f.id }, data: { emailAddress: f.emailAddress } });
      filled++;
    } catch (e) {
      console.log(`  FILL FAILED ${f.docketNumber}: ${(e as Error).message}`);
    }
  }

  console.log(`Deleted: ${deleted}/${toDelete.length} | Emails filled: ${filled}/${toFill.length}`);
}

main()
  .catch((e) => {
    console.error("\n[fix-pending-dockets] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
