/**
 * One-time backfill for the CURRENT REQT ("N") feature.
 *
 * Purpose:
 *  - Populate GmdItemCode.currentReqt from the GMD Item Creation Form (the
 *    "laser" item master, gid 2142407502).
 *  - Mark ContractReview.nBatch = "N" (contract review dashboard "N" chip).
 *  - Mark EnquiryItem.nBatch = "N" so the quotation dashboard shows
 *    "Deleted as Current Reqt = No" in the item-code cell and the
 *    "Deleted" filter can find them.
 *
 * Safety:
 *  - Dry run by default. `--apply` performs the writes.
 *  - In dry run the master is NOT re-synced (no writes) unless `--sync` is also
 *    passed. `--apply` re-syncs the master first unless `--no-sync` is passed.
 *  - Only `GmdItemCode` (via the normal master sync), `ContractReview.nBatch`
 *    and `EnquiryItem.nBatch` are ever written.
 *
 * Usage:
 *   npx tsx scripts/mark-not-current-reqt.ts            # dry run (snapshot only)
 *   npx tsx scripts/mark-not-current-reqt.ts --sync     # dry run on a fresh sheet
 *   npx tsx scripts/mark-not-current-reqt.ts --apply    # sync + write
 *   npx tsx scripts/mark-not-current-reqt.ts --apply --no-sync
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncGmdItemCodes } from "@/lib/gmdItemCodeLookup";
import {
  getNotCurrentReqtCodeSet,
  planContractReviewNotCurrentReqt,
  planNotCurrentReqtMarks,
  recomputeNotCurrentReqtMarks,
} from "@/lib/contractReviewCurrentReqt";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const NO_SYNC = args.includes("--no-sync");
const SYNC = !NO_SYNC && (APPLY || args.includes("--sync"));

const SEP = "=".repeat(74);

function short(s: string | null | undefined, n = 44): string {
  const v = String(s ?? "").trim();
  if (!v) return "-";
  return v.length > n ? v.slice(0, n - 1) + "\u2026" : v;
}

async function main() {
  console.log(`\n=== MARK NOT-CURRENT-REQT "N" (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(SEP);

  // ---- Phase 0: current-reqt master snapshot --------------------------------
  if (SYNC) {
    console.log("[master] Re-syncing GmdItemCode from the GMD Item Creation Form ...");
    try {
      const r = await syncGmdItemCodes();
      console.log(`[master] OK. ${r.count} unique 5-field row(s) stored.`);
    } catch (e) {
      console.log(`[master] SYNC FAILED: ${(e as Error).message}`);
      console.log("[master] Falling back to the existing GmdItemCode snapshot.");
    }
  } else {
    console.log("[master] Sync skipped (dry run without --sync, or --no-sync).");
  }

  const masterRows = await prisma.gmdItemCode.count();
  const withReqt = await prisma.gmdItemCode.count({
    where: { currentReqt: { not: null } },
  });
  console.log(
    `[master] GmdItemCode rows: ${masterRows}; with a CURRENT REQT value: ${withReqt}.`,
  );
  if (withReqt === 0) {
    console.log(
      "[master] WARNING: no currentReqt values are stored yet. Run with --apply (or --sync) so the master is refreshed before marking.",
    );
  }

  const notCurrent = await getNotCurrentReqtCodeSet();
  console.log(`[master] CURRENT REQT = NO item codes: ${notCurrent.size}`);

  // ---- Phase 1: quotation process impact ------------------------------------
  const enquiryItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      erpItemCode: true,
      nBatch: true,
      itemName: true,
      enquiry: { select: { docketNumber: true } },
    },
  });
  const itemPlan = planNotCurrentReqtMarks(
    enquiryItems.map((i) => ({ id: i.id, code: i.erpItemCode, nBatch: i.nBatch })),
    notCurrent,
  );
  const markedIds = new Set(itemPlan.toMark);
  const phrase = APPLY ? "marked" : "would be marked";
  const dockets = new Set(
    enquiryItems
      .filter((i) => markedIds.has(i.id))
      .map((i) => i.enquiry?.docketNumber)
      .filter(Boolean),
  );
  console.log(SEP);
  console.log(
    `[quotation] items ${phrase} "Deleted as Current Reqt = No": ${itemPlan.toMark.length} across ${dockets.size} docket(s); to clear: ${itemPlan.toClear.length}.`,
  );
  for (const i of enquiryItems.filter((i) => markedIds.has(i.id)).slice(0, 20)) {
    console.log(
      `   - ${short(i.enquiry?.docketNumber, 22)} | ${short(i.itemName, 34)} | ${i.erpItemCode}`,
    );
  }
  if (itemPlan.toMark.length > 20) {
    console.log(`   ... and ${itemPlan.toMark.length - 20} more`);
  }

  // ---- Phase 2: contract review marks ---------------------------------------
  const crRows = await prisma.contractReview.findMany({
    select: { id: true, itemCode: true, nBatch: true, contractNo: true },
  });
  const { toMark, toClear } = planContractReviewNotCurrentReqt(crRows, notCurrent);
  const crMarkIds = new Set(toMark);
  console.log(SEP);
  console.log(
    `[contract review] rows: ${crRows.length}; ${phrase} "N": ${toMark.length}; to clear: ${toClear.length}.`,
  );
  for (const r of crRows.filter((r) => crMarkIds.has(r.id)).slice(0, 20)) {
    console.log(
      `   - ${short(r.contractNo, 24)} | ${short(r.itemCode, 24)}${r.nBatch ? ` (was ${r.nBatch})` : ""}`,
    );
  }
  if (toMark.length > 20) console.log(`   ... and ${toMark.length - 20} more`);

  // ---- Phase 3: apply -------------------------------------------------------
  console.log(SEP);
  if (APPLY) {
    const res = await recomputeNotCurrentReqtMarks();
    console.log(
      `[contract review] APPLIED: marked ${res.contractReview.marked}, cleared ${res.contractReview.cleared}.`,
    );
    console.log(
      `[quotation] APPLIED: marked ${res.enquiryItem.marked}, cleared ${res.enquiryItem.cleared}.`,
    );
    console.log(
      '[ui] Not-current items now show "Deleted as Current Reqt = No" and are reachable via the Item Code "Deleted" filter.',
    );
  } else {
    console.log("[dry run] No writes. Re-run with --apply to mark.");
  }
  console.log(SEP);
}

main()
  .catch((e) => {
    console.error("\n[mark-not-current-reqt] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
