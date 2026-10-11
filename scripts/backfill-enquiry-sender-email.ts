/**
 * Backfill the sender/cc split onto existing enquiries.
 *
 * Before this feature, `Enquiry.emailAddress` held one merged list of external
 * emails. It is now split into `senderEmail` (from the thread's `sender`) and
 * `emailAddress` (the cc/rest list). This script re-derives both for every
 * enquiry from its source thread and overwrites them.
 *
 * Uses the same matching as the "Sync Emails" button, but with `onlyBlank:false`
 * so existing rows are rewritten. Dry run by default; pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-enquiry-sender-email.ts
 *   npx tsx scripts/backfill-enquiry-sender-email.ts --apply
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncEnquiryEmailAddresses } from "@/lib/enquiryEmailSync";

const APPLY = process.argv.includes("--apply");

const show = (value: string | null | undefined) => {
  const v = String(value ?? "").trim();
  return v || "-";
};

async function main() {
  console.log(`\n=== BACKFILL ENQUIRY SENDER/CC EMAIL [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  const result = await syncEnquiryEmailAddresses({ onlyBlank: false, dryRun: !APPLY });

  console.log(`Threads scanned:      ${result.threadCount}`);
  console.log(`Enquiries scanned:    ${result.scanned}`);
  console.log(`Rows to ${APPLY ? "write" : "change"}:    ${result.proposals.length} (docket ${result.proposals.length - result.matchedByParty}, party fallback ${result.matchedByParty})`);
  console.log(`Rows skipped:         ${result.skipped}\n`);

  for (const p of result.proposals) {
    const tag = p.source === "party" ? "[PARTY] " : "[CHANGE]";
    console.log(`${tag} ${p.docketNumber.padEnd(24)} sender="${show(p.senderEmail)}" cc="${show(p.emailAddress)}"`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write senderEmail + emailAddress.\n");
    return;
  }

  console.log(`\nApplied. Updated ${result.updated} row(s).\n`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
