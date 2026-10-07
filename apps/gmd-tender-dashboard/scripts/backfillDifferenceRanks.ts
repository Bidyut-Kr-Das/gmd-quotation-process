import "dotenv/config";
import { prisma } from "@/lib/prisma";

// Script: one-time backfill of TenderMerged.differenceBetweenRank1 / differenceBetweenRank2
// Rule: only where ourRank != "1" (strict trim check), ourValue + L price not null/empty and parseable, L price != 0
// Formula: ((ourValue - Lx) / Lx) * 100 -> toFixed(2) + "%"
// Target: TenderMerged.differenceBetweenRank1 / differenceBetweenRank2 only - overwrites existing
// Usage: npx tsx scripts/backfillDifferenceRanks.ts [--dryRun] [--limit=100]
// Note: Rank check is STRICT: String(ourRank).trim() !== "1"  (not "L1", per user instruction)

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dryRun");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1]!, 10) : undefined;
const BATCH_SIZE = 500;

// ---------- Parse helpers ----------

function isNullishString(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === "" || s === "-" || s === "--" || s.toLowerCase() === "null";
}

function isRankNotOne(rawRank: unknown): boolean {
  // STRICT per user: only "1" (trimmed) is considered L1. "L1" is NOT treated as 1.
  if (rawRank === null || rawRank === undefined) return false; // null rank -> do not calculate
  const s = String(rawRank).trim();
  if (s === "") return false;
  return s !== "1";
}

function parsePrice(raw: unknown): { value: number | null; cleaned: string } {
  if (isNullishString(raw)) return { value: null, cleaned: "" };
  const original = String(raw).trim();
  // Remove currency symbols, commas, spaces, NBSP, etc., keep digits, dot, minus
  // Also handles Indian grouping commas: "1,00,000" -> "100000"
  const cleaned = original
    .replace(/[\u00A0]/g, " ")
    .replace(/[₹$€£,\s]/g, "")
    .replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") {
    return { value: null, cleaned };
  }
  const num = parseFloat(cleaned);
  if (isNaN(num) || !isFinite(num)) return { value: null, cleaned };
  return { value: num, cleaned };
}

function calcPercent(our: number, l: number): number {
  return ((our - l) / l) * 100;
}

function formatPercent(n: number): string {
  return n.toFixed(2) + "%";
}

interface Row {
  id: number;
  referenceNo: string;
  ourRank: string | null;
  ourValue: string | null;
  valueOfRank1: string | null;
  valueOfRank2: string | null;
  differenceBetweenRank1: string | null;
  differenceBetweenRank2: string | null;
}

async function main() {
  console.log("=".repeat(70));
  console.log("  Backfill Difference Ranks Script (TenderMerged only)");
  console.log("  Targets: differenceBetweenRank1 / differenceBetweenRank2 -> overwrite");
  console.log("  Formula: ((ourValue - Lx)/Lx)*100 -> 2dec + \"%\"");
  console.log("  Rule: only where ourRank != \"1\" (strict trim) and all values parseable & L!=0");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE (will overwrite)"}`);
  if (LIMIT) console.log(`  Limit: ${LIMIT} rows`);
  console.log("=".repeat(70));

  // Fetch in batches with cursor pagination to avoid OOM
  let cursorId: number | undefined = undefined;
  let totalScanned = 0;
  let totalConsidered = 0;
  let skippedRankOne = 0;
  let skippedNullRank = 0;
  let skippedMissingOurValue = 0;
  let failedParseOurValue = 0;
  let failedParseL1 = 0;
  let failedParseL2 = 0;
  let skippedZeroL1 = 0;
  let skippedZeroL2 = 0;
  let updatedL1Only = 0;
  let updatedL2Only = 0;
  let updatedBoth = 0;
  let skippedNoCalculable = 0;
  let warnNegativeL1 = 0;
  let warnNegativeL2 = 0;
  let updateErrors = 0;

  for (;;) {
    const batch: Row[] = await prisma.tenderMerged.findMany({
      where: LIMIT ? undefined : undefined, // fetch all, filter in JS for strict trim logic
      select: {
        id: true,
        referenceNo: true,
        ourRank: true,
        ourValue: true,
        valueOfRank1: true,
        valueOfRank2: true,
        differenceBetweenRank1: true,
        differenceBetweenRank2: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      totalScanned++;
      if (LIMIT && totalScanned > LIMIT) break;

      // --- Rank check (STRICT "1" only) ---
      if (row.ourRank === null || String(row.ourRank).trim() === "") {
        skippedNullRank++;
        continue;
      }
      if (!isRankNotOne(row.ourRank)) {
        skippedRankOne++;
        // log at debug level for visibility
        // console.log(`SKIP rank=1 ref=${row.referenceNo} id=${row.id} rawRank="${row.ourRank}"`);
        continue;
      }

      // --- ourValue presence ---
      if (isNullishString(row.ourValue)) {
        skippedMissingOurValue++;
        continue;
      }

      totalConsidered++;

      const ourParsed = parsePrice(row.ourValue);
      if (ourParsed.value === null) {
        failedParseOurValue++;
        console.log(
          `[FAIL] ref=${row.referenceNo} id=${row.id} ourValue raw="${row.ourValue}" cleaned="${ourParsed.cleaned}" -> unparseable`,
        );
        continue;
      }
      const ourNum = ourParsed.value;

      let diff1Str: string | null = null;
      let diff2Str: string | null = null;
      let l1Num: number | null = null;
      let l2Num: number | null = null;
      let l1Cleaned = "";
      let l2Cleaned = "";

      // --- L1 ---
      if (!isNullishString(row.valueOfRank1)) {
        const p1 = parsePrice(row.valueOfRank1);
        l1Cleaned = p1.cleaned;
        if (p1.value === null) {
          failedParseL1++;
          console.log(
            `[FAIL L1] ref=${row.referenceNo} id=${row.id} valueOfRank1 raw="${row.valueOfRank1}" cleaned="${l1Cleaned}" -> unparseable, l1 diff skipped`,
          );
        } else if (p1.value === 0) {
          skippedZeroL1++;
          console.log(
            `[SKIP L1 ZERO] ref=${row.referenceNo} id=${row.id} valueOfRank1 raw="${row.valueOfRank1}" cleaned="${l1Cleaned}" -> 0, division by zero avoided`,
          );
        } else {
          l1Num = p1.value;
          const pct = calcPercent(ourNum, l1Num);
          diff1Str = formatPercent(pct);
          const note = pct < 0 ? " [WARN negative - our cheaper than L1 but rank !=1, check data]" : "";
          if (pct < 0) warnNegativeL1++;
          console.log(
            `[OK L1] ref=${row.referenceNo} id=${row.id} ourValue raw="${row.ourValue}" (${ourNum}) L1 raw="${row.valueOfRank1}" (${l1Num}, cleaned="${l1Cleaned}") -> diff=${diff1Str}${note} (was "${row.differenceBetweenRank1 ?? ""}")`,
          );
        }
      }

      // --- L2 ---
      if (!isNullishString(row.valueOfRank2)) {
        const p2 = parsePrice(row.valueOfRank2);
        l2Cleaned = p2.cleaned;
        if (p2.value === null) {
          failedParseL2++;
          console.log(
            `[FAIL L2] ref=${row.referenceNo} id=${row.id} valueOfRank2 raw="${row.valueOfRank2}" cleaned="${l2Cleaned}" -> unparseable, l2 diff skipped`,
          );
        } else if (p2.value === 0) {
          skippedZeroL2++;
          console.log(
            `[SKIP L2 ZERO] ref=${row.referenceNo} id=${row.id} valueOfRank2 raw="${row.valueOfRank2}" cleaned="${l2Cleaned}" -> 0, division by zero avoided`,
          );
        } else {
          l2Num = p2.value;
          const pct = calcPercent(ourNum, l2Num);
          diff2Str = formatPercent(pct);
          const note = pct < 0 ? " [WARN negative - our cheaper than L2, check data]" : "";
          if (pct < 0) warnNegativeL2++;
          console.log(
            `[OK L2] ref=${row.referenceNo} id=${row.id} ourValue raw="${row.ourValue}" (${ourNum}) L2 raw="${row.valueOfRank2}" (${l2Num}, cleaned="${l2Cleaned}") -> diff=${diff2Str}${note} (was "${row.differenceBetweenRank2 ?? ""}")`,
          );
        }
      }

      if (diff1Str === null && diff2Str === null) {
        skippedNoCalculable++;
        continue;
      }

      const data: Record<string, string> = {};
      if (diff1Str !== null) data.differenceBetweenRank1 = diff1Str;
      if (diff2Str !== null) data.differenceBetweenRank2 = diff2Str;

      if (DRY_RUN) {
        const both = diff1Str !== null && diff2Str !== null;
        if (both) updatedBoth++;
        else if (diff1Str !== null) updatedL1Only++;
        else updatedL2Only++;
        console.log(`[DRYRUN] would update id=${row.id} ref=${row.referenceNo} -> ${JSON.stringify(data)}`);
        continue;
      }

      try {
        await prisma.tenderMerged.update({ where: { id: row.id }, data });
        if (diff1Str !== null && diff2Str !== null) updatedBoth++;
        else if (diff1Str !== null) updatedL1Only++;
        else updatedL2Only++;
      } catch (err) {
        updateErrors++;
        console.warn(`[ERROR] update failed id=${row.id} ref=${row.referenceNo} data=${JSON.stringify(data)} err=${(err as Error).message}`);
      }
    }

    cursorId = batch[batch.length - 1]!.id;
    if (LIMIT && totalScanned >= LIMIT) break;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log("\n" + "=".repeat(70));
  console.log("  Summary");
  console.log("=".repeat(70));
  console.log(`  Total scanned:               ${totalScanned}`);
  console.log(`  Considered (rank!=1 & ourValue present): ${totalConsidered}`);
  console.log(`  Skipped rank="1" (strict):   ${skippedRankOne}`);
  console.log(`  Skipped null/empty rank:     ${skippedNullRank}`);
  console.log(`  Skipped missing ourValue:    ${skippedMissingOurValue}`);
  console.log(`  Failed parse ourValue:       ${failedParseOurValue}`);
  console.log(`  Failed parse L1:             ${failedParseL1}`);
  console.log(`  Failed parse L2:             ${failedParseL2}`);
  console.log(`  Skipped L1 zero:             ${skippedZeroL1}`);
  console.log(`  Skipped L2 zero:             ${skippedZeroL2}`);
  console.log(`  WARN negative L1 (our < L1): ${warnNegativeL1}`);
  console.log(`  WARN negative L2 (our < L2): ${warnNegativeL2}`);
  console.log(`  Skipped no calculable diff:  ${skippedNoCalculable}`);
  console.log(`  Updated L1 only:             ${updatedL1Only}`);
  console.log(`  Updated L2 only:             ${updatedL2Only}`);
  console.log(`  Updated both L1+L2:          ${updatedBoth}`);
  console.log(`  Total updated:               ${updatedL1Only + updatedL2Only + updatedBoth}`);
  console.log(`  Update errors:               ${updateErrors}`);
  console.log(`  Mode:                        ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("=".repeat(70));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
