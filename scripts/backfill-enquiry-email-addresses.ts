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
  console.log(`Enquiries scanned:                  ${result.scanned}`);
  console.log(`Rows that would change (fill blank): ${result.proposals.length}`);
  console.log(`Rows skipped (has value / no match): ${result.skipped}\n`);

  if (result.proposals.length > 0) {
    console.log("--- PREVIEW (docket -> email address) ---");
    for (const p of result.proposals) {
      console.log(`[CHANGE] ${p.docketNumber.padEnd(24)} -> ${show(p.emailAddress)}`);
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
