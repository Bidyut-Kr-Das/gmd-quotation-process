import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function sameContractNos(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Case-insensitive, trimmed match key (party names differ only by casing between the tables).
function partyKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

async function main() {
  console.log("\n=== SYNC CONTRACT NO (from ContractReview by party name) ===\n");

  const contractRows = await prisma.contractReview.findMany({
    select: { contractNo: true, partyNameDump: true },
  });

  // Case-insensitive exact (trimmed) match on ContractReview.partyNameDump -> distinct contract numbers.
  const byParty = new Map<string, string[]>();
  for (const row of contractRows) {
    const party = partyKey(row.partyNameDump);
    const contractNo = (row.contractNo ?? "").trim();
    if (!party || !contractNo) continue;
    const list = byParty.get(party);
    if (!list) {
      byParty.set(party, [contractNo]);
    } else if (!list.includes(contractNo)) {
      list.push(contractNo);
    }
  }

  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, partyName: true, contractNo: true },
  });

  let updated = 0;
  let matched = 0;
  const unmatchedParties = new Set<string>();

  for (const enquiry of enquiries) {
    const party = partyKey(enquiry.partyName);
    const next = byParty.get(party) ?? [];
    if (next.length > 0) matched++;
    else if (party) unmatchedParties.add((enquiry.partyName ?? "").trim());

    if (!sameContractNos(enquiry.contractNo ?? [], next)) {
      await prisma.enquiry.update({
        where: { id: enquiry.id },
        data: { contractNo: next },
      });
      updated++;
    }
  }

  console.log(`ContractReview rows:       ${contractRows.length}`);
  console.log(`Distinct parties matched:  ${byParty.size}`);
  console.log(`Enquiries scanned:         ${enquiries.length}`);
  console.log(`Enquiries matched:         ${matched}`);
  console.log(`Enquiries updated:         ${updated}`);
  console.log(`Unmatched enquiry parties: ${unmatchedParties.size}`);

  if (unmatchedParties.size > 0) {
    console.log("\n--- Unmatched party names (first 25) ---");
    for (const p of [...unmatchedParties].sort().slice(0, 25)) {
      console.log(`  ${p}`);
    }
    if (unmatchedParties.size > 25) {
      console.log(`  ... and ${unmatchedParties.size - 25} more`);
    }
  }

  console.log("\n=== SYNC DONE ===\n");
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
