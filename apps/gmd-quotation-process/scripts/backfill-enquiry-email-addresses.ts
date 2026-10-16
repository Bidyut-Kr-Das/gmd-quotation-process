import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncEnquiryEmailAddresses } from "@/lib/enquiryEmailSync";

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(`\n=== BACKFILL ENQUIRY EMAIL ADDRESSES [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  const result = await syncEnquiryEmailAddresses({ onlyBlank: true, dryRun: !APPLY });

  console.log(`Threads scanned:                    ${result.threadCount}`);
  console.log(`Distinct parties with external email: ${result.partyCount}`);
  console.log(`Enquiries scanned:                  ${result.scanned}`);
  console.log(`Rows that would change (fill blank): ${result.proposals.length} (docket ${result.proposals.length - result.matchedByParty}, party fallback ${result.matchedByParty})`);
  console.log(`Rows skipped (has value / no match): ${result.skipped}\n`);

  if (result.proposals.length > 0) {
    console.log("--- PREVIEW (docket -> sender / cc) ---");
    for (const p of result.proposals) {
      const tag = p.source === "party" ? "[PARTY] " : "[CHANGE]";
      console.log(`${tag} ${p.docketNumber.padEnd(24)} sender: ${show(p.senderEmail)} | cc: ${show(p.emailAddress)}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write emailAddress.\n");
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
