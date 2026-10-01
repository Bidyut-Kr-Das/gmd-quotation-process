/**
 * One-time ERP item code re-derivation.
 *
 * Re-derives EnquiryItem.erpItemCode from the Google Sheet master ("GMD Item
 * Creation Form", gid 2142407502) using the SAME 5-field exact composite lookup
 * the app uses: itemType + moc + operationType + size + pnRating.
 *
 * Rules:
 *  - Only items where erpItemCode IS NOT NULL are considered. Blank codes are
 *    left completely alone (backfillExistingItems() already owns those).
 *  - Cost columns are NEVER written. This script only touches the item code
 *    and its BOM linkage (bomId, bomType, rmItemCode, rmType, availableStock,
 *    availableBomIds). productCost / cost / vaPercent / quotedRate / totalValue
 *    are left exactly as they are.
 *  - No BOM gate, matching current app behaviour (gate is commented out in
 *    lib/gmdItemCodeLookup.ts).
 *
 *  --blank-unmatched additionally NULLS OUT the code and its BOM linkage on every
 *  item the sheet cannot vouch for:
 *    - NO_MATCH       all 5 fields present, no such row in the sheet -> code is wrong
 *    - MISSING_FIELD  a field is blank, so the lookup cannot run. Blanked only if the
 *                    sheet has no row for the item's OTHER fields carrying that code
 *                    (i.e. the code is not even plausible). Plausible ones are kept.
 *
 *  --blank-unmatched-except=<code> keeps one specific code from being blanked.
 *  - No BOM gate, matching current app behaviour (gate is commented out in
 *    lib/gmdItemCodeLookup.ts).
 *
 * Dry run by default. Pass --apply to write.
 *
 * ---------------------------------------------------------------------------
 * CASCADE FUNCTION BELOW IS A DELIBERATE COPY
 * ---------------------------------------------------------------------------
 * `localSyncAvailableBomIds` is a verbatim port of the private helper at
 * `app/actions.ts:1289-1306`. It is duplicated so this script can run without
 * touching the "use server" module. If that logic changes, this MUST be
 * re-synced. That is the trade-off of leaving app/actions.ts untouched.
 *
 * The cost cascade (app/actions.ts:1313-1482, maybeUpdateProductCostFromNewCode)
 * is deliberately NOT ported. It writes productCost / cost / vaPercent, which
 * this script is not allowed to touch.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { syncGmdItemCodes, getDetailedItemCodeFailureReason } from "@/lib/gmdItemCodeLookup";
import { getDistinctBomIds, getNoUseBomIdSet } from "@/lib/verifyBomLookup";
import { isEnquiryFrozen } from "@/lib/oneClickAccess";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SYNC = !args.includes("--no-sync");
const BLANK_UNMATCHED = args.includes("--blank-unmatched");
const KEEP_STALE_BOM = args.includes("--keep-stale-bom");
const TTY = process.stdout.isTTY;
const BLANK_EXCEPT = (args.find((a) => a.startsWith("--blank-unmatched-except="))?.split("=")[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const DOCKETS = args
  .find((a) => a.startsWith("--docket="))
  ?.split("=")[1]
  ?.split(",")
  .map((d) => d.trim())
  .filter(Boolean);
const FOCUS_CODE = (args.find((a) => a.startsWith("--focus="))?.split("=")[1] ?? "FBC010486").trim();

type Bucket = "OK" | "WOULD_CHANGE" | "NO_MATCH" | "MISSING_FIELD" | "SKIPPED_FROZEN";

type Row = {
  id: string;
  docketNumber: string;
  itemName: string;
  itemType: string | null;
  moc: string | null;
  operationType: string | null;
  size: string | null;
  pnRating: string | null;
  erpItemCode: string;
  bomId: string | null;
  bomType: string | null;
  rmItemCode: string | null;
  rmType: string | null;
  availableStock: string | null;
  productCost: string | null;
  cost: string | null;
  availableBomIds: string[];
  apm: string | null;
  offerPdfGeneratedAt: Date | null;
  frozen: boolean;
};

type Report = {
  bucket: Bucket;
  row: Row;
  expected: string | null;
  phantom: boolean;
  reason?: string;
  looseMatch?: string;
  /** --blank-unmatched: this code should be nulled out. */
  blank: boolean;
  /** Why the code is (or is not) plausible for a partially-filled item. */
  plausibility?: string;
};

const sep = (n = 78) => "-".repeat(n);
const dec = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------------
// Verbatim port of app/actions.ts:1289-1306 (syncAvailableBomIds)
// ---------------------------------------------------------------------------
async function localSyncAvailableBomIds(
  itemId: string,
  erpItemCode: string | null
): Promise<string[]> {
  try {
    if (!erpItemCode) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
      return [];
    }
    const ids = await getDistinctBomIds(erpItemCode);
    const noUse = await getNoUseBomIdSet(ids);
    const filtered = ids.filter((id) => !noUse.has(id));
    // Per-code updateMany so every item sharing the code gets an identical array.
    await prisma.enquiryItem.updateMany({
      where: { erpItemCode },
      data: { availableBomIds: filtered },
    });
    return filtered;
  } catch (e) {
    console.warn(`[syncAvailableBomIds] failed for ${itemId} code=${erpItemCode}:`, e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Same 5-field exact lookup the app performs (lib/gmdItemCodeLookup.ts:144-164).
// Raw values, no trim, no case folding - byte-identical to the composite key.
// ---------------------------------------------------------------------------
async function expectedCodeFor(row: Row): Promise<string | null> {
  const match = await prisma.gmdItemCode.findUnique({
    where: {
      itemType_moc_operation_size_pnGmd: {
        itemType: row.itemType as string,
        moc: row.moc as string,
        operation: row.operationType as string,
        size: row.size as string,
        pnGmd: row.pnRating as string,
      },
    },
    select: { itemCode: true },
  });
  return match?.itemCode ?? null;
}

/** Case + whitespace insensitive retry, to separate "malformed value" from
 *  "the master genuinely has no such combination". */
async function looseMatchFor(row: Row): Promise<string | undefined> {
  const n = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const candidates = await prisma.gmdItemCode.findMany({
    where: {
      itemType: { equals: row.itemType ?? "", mode: "insensitive" },
      moc: { equals: row.moc ?? "", mode: "insensitive" },
      size: { equals: row.size ?? "", mode: "insensitive" },
    },
    select: { itemCode: true, operation: true, pnGmd: true },
  });
  const hit = candidates.find(
    (c) => n(c.operation) === n(row.operationType) && n(c.pnGmd) === n(row.pnRating)
  );
  return hit?.itemCode;
}

/**
 * For an item with a blank 5-field value, decide whether the code it already
 * carries could still be the right one.
 *
 * Looks for ANY master row whose itemCode equals the item's current code and
 * whose fields that the item DOES have match exactly. Blank item fields are
 * wildcards, so a hit means "this code is at least consistent with what we know
 * about the item" -> keep it. No hit means the code describes a different
 * product -> it is wrong.
 */
async function codeIsPlausible(
  row: Row
): Promise<{ possible: boolean; detail: string }> {
  // Blank item fields are wildcards, so only constrain on the ones present.
  const where: { itemCode: string; itemType?: string; moc?: string; operation?: string; size?: string; pnGmd?: string } = {
    itemCode: row.erpItemCode,
  };
  const used: string[] = [];
  if (row.itemType?.trim()) where.itemType = row.itemType;
  if (row.moc?.trim()) where.moc = row.moc;
  if (row.operationType?.trim()) where.operation = row.operationType;
  if (row.size?.trim()) where.size = row.size;
  if (row.pnRating?.trim()) where.pnGmd = row.pnRating;
  for (const k of Object.keys(where)) {
    if (k !== "itemCode") used.push(k);
  }

  const rows = await prisma.gmdItemCode.findMany({
    where,
    select: { itemType: true, moc: true, operation: true, size: true, pnGmd: true },
  });

  if (rows.length === 0) {
    return {
      possible: false,
      detail: `the sheet has no row carrying ${row.erpItemCode} at all, so it cannot describe this item`,
    };
  }
  return {
    possible: true,
    detail: `the sheet maps ${row.erpItemCode} to ${rows[0].itemType} / ${rows[0].moc} / ${rows[0].operation} / ${rows[0].size}mm / ${rows[0].pnGmd}, which matches this item on ${used.join(", ")} - the code is probably correct, the blank field is the problem`,
  };
}

function describe(row: Row) {
  return [
    row.itemType ?? "~",
    row.moc ?? "~",
    row.operationType ?? "~",
    `${row.size ?? "~"}mm`,
    row.pnRating ?? "~",
  ].join(" / ");
}

function short(s: string | null, n = 44) {
  if (!s) return "-";
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}

async function main() {
  console.log(`\n=== REFRESH ERP ITEM CODES (${APPLY ? "APPLY" : "DRY RUN - no item writes"}) ===`);
  console.log(sep());

  // ---- Phase 0: fresh master baseline -------------------------------------
  const before = await prisma.gmdItemCode.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  const beforeCount = await prisma.gmdItemCode.count();
  if (SYNC) {
    console.log("[sync] Re-syncing GmdItemCode from Google Sheet (gid 2142407502) ...");
    try {
      const r = await syncGmdItemCodes();
      console.log(
        `[sync] OK. ${r.count} data row(s) in the sheet -> ${await prisma.gmdItemCode.count()} unique 5-field combination(s) stored.`
      );
      console.log(
        "[sync] NOTE: the sheet holds more rows than unique combinations, so skipDuplicates means the FIRST row for a repeated combination wins."
      );
    } catch (e) {
      console.log(`[sync] FAILED: ${(e as Error).message}`);
      console.log("[sync] Falling back to the existing GmdItemCode snapshot.");
    }
  } else {
    console.log("[sync] Skipped (--no-sync).");
  }
  const after = await prisma.gmdItemCode.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  const afterCount = await prisma.gmdItemCode.count();
  console.log(
    `[sync] Snapshot: ${beforeCount} rows (last ${before?.syncedAt ? before.syncedAt.toISOString() : "never"})` +
      ` -> ${afterCount} rows (last ${after?.syncedAt ? after.syncedAt.toISOString() : "never"})`
  );

  // Codes that DO exist in the master, used to separate phantom from mis-assigned.
  const masterCodes = new Set(
    (await prisma.gmdItemCode.findMany({ select: { itemCode: true } })).map((m) => m.itemCode)
  );

  // ---- Phase 1: candidates -------------------------------------------------
  const raw = await prisma.enquiryItem.findMany({
    where: {
      erpItemCode: { not: null },
      ...(DOCKETS?.length ? { enquiry: { docketNumber: { in: DOCKETS } } } : {}),
    },
    select: {
      id: true,
      itemName: true,
      itemType: true,
      moc: true,
      operationType: true,
      size: true,
      pnRating: true,
      erpItemCode: true,
      bomId: true,
      bomType: true,
      rmItemCode: true,
      rmType: true,
      availableStock: true,
      productCost: true,
      cost: true,
      availableBomIds: true,
      enquiry: { select: { docketNumber: true, apm: true, offerPdfGeneratedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const all: Row[] = raw.map((r) => ({
    id: r.id,
    docketNumber: r.enquiry.docketNumber,
    itemName: r.itemName,
    itemType: r.itemType,
    moc: r.moc,
    operationType: r.operationType,
    size: r.size,
    pnRating: r.pnRating,
    erpItemCode: r.erpItemCode as string,
    bomId: r.bomId,
    bomType: r.bomType,
    rmItemCode: r.rmItemCode,
    rmType: r.rmType,
    availableStock: r.availableStock,
    productCost: dec(r.productCost),
    cost: dec(r.cost),
    availableBomIds: r.availableBomIds ?? [],
    apm: r.enquiry.apm,
    offerPdfGeneratedAt: r.enquiry.offerPdfGeneratedAt,
    frozen: isEnquiryFrozen(r.enquiry.apm, r.enquiry.offerPdfGeneratedAt),
  }));
  const rows = LIMIT > 0 ? all.slice(0, LIMIT) : all;
  console.log(
    `Items with an item code${DOCKETS?.length ? ` in ${DOCKETS.length} docket(s)` : ""}: ${all.length}` +
      `${LIMIT > 0 ? ` (processing first ${rows.length})` : ""}\n`
  );

  // ---- Phase 2: expected code per item, straight from the DB ---------------
  const reports: Report[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (TTY) {
      process.stdout.write(
        `\r[lookup ${i + 1}/${rows.length}] ${row.docketNumber.padEnd(20)} ${short(row.itemName, 34)}   `
      );
    }
    const phantom = !masterCodes.has(row.erpItemCode);
    const hasAllFive = [row.itemType, row.moc, row.size, row.pnRating, row.operationType].every(
      (v) => typeof v === "string" && v.trim() !== ""
    );

    if (!hasAllFive) {
      const missing = [
        !row.itemType ? "Type" : "",
        !row.moc ? "MOC" : "",
        !row.size ? "Size" : "",
        !row.pnRating ? "PN" : "",
        !row.operationType ? "Op Type" : "",
      ]
        .filter(Boolean)
        .join(", ");
      // A partially-filled item cannot be looked up. But the code it already
      // carries may still be right. Test whether the sheet has ANY row carrying
      // that code whose non-blank fields agree with this item. If yes the code is
      // plausible -> keep. If no, the code belongs to something else -> blank.
      const plausible = await codeIsPlausible(row);
      reports.push({
        bucket: "MISSING_FIELD",
        row,
        expected: null,
        phantom,
        blank: !plausible.possible && !BLANK_EXCEPT.includes(row.erpItemCode),
        plausibility: plausible.detail,
        reason: `Missing field(s): ${missing}. ${plausible.detail}`,
      });
      continue;
    }

    const expected = await expectedCodeFor(row);
    if (expected === null) {
      reports.push({
        bucket: "NO_MATCH",
        row,
        expected: null,
        phantom,
        // All 5 fields are present and the sheet has no row for them, so this
        // code cannot belong to this item.
        blank: !BLANK_EXCEPT.includes(row.erpItemCode),
        reason: await getDetailedItemCodeFailureReason(row),
        looseMatch: await looseMatchFor(row),
      });
      continue;
    }
    if (expected === row.erpItemCode) {
      reports.push({ bucket: "OK", row, expected, phantom, blank: false });
      continue;
    }
    if (row.frozen) {
      reports.push({ bucket: "SKIPPED_FROZEN", row, expected, phantom, blank: false });
      continue;
    }
    reports.push({ bucket: "WOULD_CHANGE", row, expected, phantom, blank: false });
  }
  if (TTY) process.stdout.write("\r".padEnd(100) + "\r");

  // ---- Phase 3: report -----------------------------------------------------
  const by = (b: Bucket) => reports.filter((r) => r.bucket === b);
  const changes = by("WOULD_CHANGE");
  const noMatch = by("NO_MATCH");
  const missing = by("MISSING_FIELD");
  const frozen = by("SKIPPED_FROZEN");

  console.log("\n--- SUMMARY ---");
  console.log(
    `  OK ${by("OK").length} | WOULD_CHANGE ${changes.length} | NO_MATCH ${noMatch.length}` +
      ` | MISSING_FIELD ${missing.length} | SKIPPED_FROZEN ${frozen.length}`
  );
  const phantomAll = reports.filter((r) => r.phantom);
  const misassigned = reports.filter((r) => !r.phantom && r.bucket !== "OK" && r.bucket !== "WOULD_CHANGE");
  console.log(
    `  Codes shown but ABSENT from the sheet (phantom): ${phantomAll.length} items / ` +
      `${new Set(phantomAll.map((r) => r.row.erpItemCode)).size} codes`
  );
  console.log(`  Codes the sheet would never assign (kept as-is): ${misassigned.length} items`);

  // [1] Phantom codes --------------------------------------------------------
  console.log(`\n--- [1] PHANTOM CODES: showing in the DB but ABSENT from the Google Sheet ---`);
  if (phantomAll.length === 0) console.log("  (none)");
  else {
    const byCode = new Map<string, Report[]>();
    for (const r of phantomAll) {
      if (!byCode.has(r.row.erpItemCode)) byCode.set(r.row.erpItemCode, []);
      byCode.get(r.row.erpItemCode)!.push(r);
    }
    const ordered = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [code, list] of ordered) {
      const combos = new Map<string, number>();
      for (const r of list) {
        const d = describe(r.row);
        combos.set(d, (combos.get(d) ?? 0) + 1);
      }
      const fixable = list.filter((r) => r.bucket === "WOULD_CHANGE");
      console.log(`\n  ${code}  ${list.length} item(s)  [${fixable.length} auto-repairable, ${list.length - fixable.length} not]`);
      for (const [combo, n] of [...combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
        console.log(`      ${String(n).padStart(3)}x  ${combo}`);
      }
      if (combos.size > 6) console.log(`      ...and ${combos.size - 6} more field combination(s)`);
      for (const r of list.filter((x) => x.bucket === "WOULD_CHANGE").slice(0, 4)) {
        console.log(
          `      WILL FIX  ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode} -> ${r.expected}  (${r.row.bomId ?? "no bomId"}, cost ${r.row.productCost ?? "null"})`
        );
      }
      if (fixable.length > 4) console.log(`      ...and ${fixable.length - 4} more to be repaired`);
      for (const r of list.filter((x) => x.bucket !== "WOULD_CHANGE")) {
        console.log(
          `      KEEPING   ${r.row.docketNumber.padEnd(20)} ${describe(r.row)}  [${r.bucket}: ${r.reason ?? "no master row"}]`
        );
      }
    }
  }

  // [2] Mis-assigned ---------------------------------------------------------
  console.log(`\n--- [2] MIS-ASSIGNED: the sheet has no row for these fields, so the code shown is not what the sheet assigns ---`);
  if (misassigned.length === 0) console.log("  (none)");
  else {
    const byCode = new Map<string, Report[]>();
    for (const r of misassigned) {
      if (!byCode.has(r.row.erpItemCode)) byCode.set(r.row.erpItemCode, []);
      byCode.get(r.row.erpItemCode)!.push(r);
    }
    for (const [code, list] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${code}  ${list.length} item(s)  -  KEEPING this code, it cannot be re-derived`);
      const master = await prisma.gmdItemCode.findFirst({
        where: { itemCode: code },
        select: { itemType: true, moc: true, operation: true, size: true, pnGmd: true },
      });
      console.log(
        `      sheet maps ${code} -> ${master ? `${master.itemType} / ${master.moc} / ${master.operation} / ${master.size}mm / ${master.pnGmd}` : "?"}`
      );
      for (const r of list) {
        console.log(`      - ${r.row.docketNumber.padEnd(20)} ${describe(r.row)}`);
      }
      const first = list.find((r) => r.reason);
      if (first?.reason) console.log(`      reason: ${first.reason}`);
      console.log(
        `      near match (case/space only): ${first?.looseMatch ?? "none - the combination is genuinely absent from the sheet"}`
      );
    }
  }

  // [3] Missing field --------------------------------------------------------
  console.log(`\n--- [3] NOT RE-DERIVABLE: a 5-field value is blank ---`);
  if (missing.length === 0) console.log("  (none)");
  else
    for (const r of missing) {
      console.log(`  ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode}  ${describe(r.row)}  - ${r.reason}`);
    }

  // [4] Would change ---------------------------------------------------------
  console.log(`\n--- [4] WOULD CHANGE (${changes.length}) - code corrected, cascade applied on apply ---`);
  if (changes.length === 0) console.log("  (none)");
  else {
    for (const r of changes.slice(0, 40)) {
      console.log(
        `  ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode} -> ${r.expected}  ${short(r.row.itemName, 40).padEnd(40)} bomId ${r.row.bomId ?? "-"} / cost ${r.row.productCost ?? "null"}${r.phantom ? "  [phantom]" : ""}`
      );
    }
    if (changes.length > 40) console.log(`  ...and ${changes.length - 40} more`);
    const newCodes = [...new Set(changes.map((r) => r.expected!))];
    const vbRows = await prisma.verifyBom.findMany({
      where: { itemCode: { in: newCodes } },
      select: { itemCode: true },
      distinct: ["itemCode"],
    });
    const vbCodes = new Set(vbRows.map((r) => r.itemCode));
    const noBom = newCodes.filter((c) => !vbCodes.has(c));
    console.log(`  \n  WARNING: ${noBom.length} new code(s) have no VerifyBom row - availableBomIds will empty and cost will not auto-fill:`);
    console.log(`           ${noBom.join(", ") || "none"}`);
  }

  // [5] Frozen ---------------------------------------------------------------
  console.log(`\n--- [5] SKIPPED_FROZEN (${frozen.length}) - Offer PDF already generated, no writes ---`);
  if (frozen.length === 0) console.log("  (none)");
  else
    for (const r of frozen) {
      console.log(`  ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode} -> ${r.expected}`);
    }

  // [6] Focus code -----------------------------------------------------------
  console.log(`\n--- [6] FOCUS: ${FOCUS_CODE} ---`);
  const focus = reports.filter(
    (r) => r.row.erpItemCode === FOCUS_CODE || r.expected === FOCUS_CODE
  );
  if (focus.length === 0) console.log(`  No item references ${FOCUS_CODE}.`);
  else {
    const master = await prisma.gmdItemCode.findFirst({
      where: { itemCode: FOCUS_CODE },
      select: { itemType: true, moc: true, operation: true, size: true, pnGmd: true },
    });
    console.log(
      `  sheet maps ${FOCUS_CODE} -> ${master ? `${master.itemType} / ${master.moc} / ${master.operation} / ${master.size}mm / ${master.pnGmd}` : "(not in sheet)"}`
    );
    const buckets = new Map<Bucket, number>();
    for (const r of focus) buckets.set(r.bucket, (buckets.get(r.bucket) ?? 0) + 1);
    const combos = new Map<string, number>();
    for (const r of focus) {
      const d = describe(r.row);
      combos.set(d, (combos.get(d) ?? 0) + 1);
    }
    console.log(
      `  ${[...buckets.entries()].map(([b, n]) => `${b} ${n}`).join(" | ")}`
    );
    for (const [combo, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}x  ${combo}`);
    }
    // One reason per distinct field combination, not one per item.
    for (const [combo] of combos) {
      const sample = focus.find((r) => describe(r.row) === combo && r.reason);
      if (sample?.reason) console.log(`\n    reason for [${combo}]:\n      ${sample.reason}`);
      if (sample?.looseMatch) console.log(`      NEAR MATCH (case/space only): ${sample.looseMatch}`);
    }
  }

  // ---- JSON report ---------------------------------------------------------
  const reportPath = path.join(process.cwd(), "tmp", "refresh-item-codes-report.json");
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: APPLY ? "apply" : "dry-run",
          gmdItemCodeRows: afterCount,
          gmdItemCodeSyncedAt: after?.syncedAt ?? null,
          focusCode: FOCUS_CODE,
          counts: {
            total: reports.length,
            OK: by("OK").length,
            WOULD_CHANGE: changes.length,
            NO_MATCH: noMatch.length,
            MISSING_FIELD: missing.length,
            SKIPPED_FROZEN: frozen.length,
            phantom: phantomAll.length,
            misassignedKept: misassigned.length,
          },
          items: reports.map((r) => ({
            bucket: r.bucket,
            phantom: r.phantom,
            docketNumber: r.row.docketNumber,
            itemName: r.row.itemName,
            itemId: r.row.id,
            currentCode: r.row.erpItemCode,
            expectedCode: r.expected,
            itemType: r.row.itemType,
            moc: r.row.moc,
            operationType: r.row.operationType,
            size: r.row.size,
            pnRating: r.row.pnRating,
            bomId: r.row.bomId,
            rmItemCode: r.row.rmItemCode,
            productCost: r.row.productCost,
            cost: r.row.cost,
            availableBomIds: r.row.availableBomIds,
            frozen: r.row.frozen,
            blank: r.blank,
            plausibility: r.plausibility ?? null,
            reason: r.reason ?? null,
            looseMatch: r.looseMatch ?? null,
          })),
        },
        null,
        2
      )
    );
    console.log(`\nFull report written to ${reportPath}`);
  } catch (e) {
    console.log(`\nCould not write report: ${(e as Error).message}`);
  }

  // [7] To be blanked -------------------------------------------------------
  console.log(`\n--- [7] WOULD BE BLANKED (${reports.filter((r) => r.blank).length}) ---`);
  if (reports.filter((r) => r.blank).length === 0) console.log("  (none)");
  else {
    const kept = reports.filter((r) => r.bucket === "MISSING_FIELD" && !r.blank);
    for (const r of reports.filter((x) => x.blank)) {
      console.log(
        `  ${r.bucket.padEnd(14)} ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode.padEnd(12)} bomId ${r.row.bomId ?? "-"} / rm ${r.row.rmItemCode ?? "-"} / cost ${r.row.productCost ?? "null"}`
      );
      console.log(`  ${" ".repeat(14)} ${describe(r.row)}`);
    }
    if (kept.length > 0) {
      console.log(`\n  KEPT (code still plausible, only a field is missing):`);
      for (const r of kept) {
        console.log(`  ${r.row.docketNumber.padEnd(20)} ${r.row.erpItemCode.padEnd(12)} ${describe(r.row)}`);
        console.log(`  ${" ".repeat(20)} ${r.plausibility}`);
      }
    }
  }

  if (!APPLY) {
    console.log(`\n${sep()}`);
    console.log("DRY RUN. Nothing was written to EnquiryItem.");
    console.log("Re-run with --apply to persist. Options:");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --blank-unmatched     # also null the wrong codes + their BOM");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --limit=50          # rehearse on 50");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --docket=GMD/2026-27/055");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --keep-stale-bom     # do not clear stale bomId");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --blank-unmatched --blank-unmatched-except=FCE070025");
    console.log("  npx tsx scripts/refresh-item-codes.ts --no-sync                    # reuse current snapshot");
    await prisma.$disconnect();
    return;
  }

  // ---- Phase 4: apply ------------------------------------------------------
  console.log(`\n${sep()}\nAPPLYING ${changes.length} code change(s)...\n`);
  let done = 0;
  let failed = 0;
  const applied: string[] = [];

  for (let i = 0; i < changes.length; i++) {
    const r = changes[i];
    const id = r.row.id;
    const from = r.row.erpItemCode;
    const to = r.expected!;
    if (TTY) {
      process.stdout.write(
        `\r[${i + 1}/${changes.length}] ${r.row.docketNumber.padEnd(20)} ${from} -> ${to}`.padEnd(90)
      );
    }
    try {
      if (!KEEP_STALE_BOM) {
        // The code changed, so any bomId/bomType/rmItemCode/rmType/availableStock
        // on this row belonged to the OLD code. Clear them.
        await prisma.enquiryItem.update({
          where: { id },
          data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
        });
      }
      await prisma.enquiryItem.update({ where: { id }, data: { erpItemCode: to } });
      await localSyncAvailableBomIds(id, to);
      // No cost cascade: productCost / cost / vaPercent / quotedRate are never
      // written by this script.
      applied.push(id);
      done++;
    } catch (e) {
      failed++;
      console.log(`\n  FAILED ${id}: ${(e as Error).message}`);
    }
  }

  // ---- Phase 5: blank un-vouchable codes -----------------------------------
  const toBlank = reports.filter((r) => r.blank);
  if (BLANK_UNMATCHED) {
    console.log(`\n${sep()}\nBLANKING ${toBlank.length} un-vouchable code(s)...\n`);
    let blanked = 0;
    let blankFailed = 0;
    for (let i = 0; i < toBlank.length; i++) {
      const r = toBlank[i];
      if (TTY) {
        process.stdout.write(
          `\r[${i + 1}/${toBlank.length}] ${r.row.docketNumber.padEnd(20)} clear ${r.row.erpItemCode}`.padEnd(90)
        );
      }
      try {
        await prisma.enquiryItem.update({
          where: { id: r.row.id },
          data: {
            erpItemCode: null,
            bomId: null,
            bomType: null,
            rmItemCode: null,
            rmType: null,
            availableStock: null,
            availableBomIds: [],
          },
        });
        blanked++;
      } catch (e) {
        blankFailed++;
        console.log(`\n  FAILED ${r.row.id}: ${(e as Error).message}`);
      }
    }
    if (TTY) process.stdout.write(`\r${" ".padEnd(100)}\r`);
    console.log(`  blanked: ${blanked} | failed: ${blankFailed}`);
  } else if (toBlank.length > 0) {
    console.log(
      `\n  ${toBlank.length} item(s) would be blanked. Re-run with --blank-unmatched to do it (see section [7]).`
    );
  }

  if (TTY) process.stdout.write(`\r${" ".padEnd(100)}\r`);
  const blankedCount = BLANK_UNMATCHED ? toBlank.length : 0;
  console.log(`\n=== DONE ===`);
  console.log(`  codes changed           : ${done}`);
  console.log(`  failed                  : ${failed}`);
  console.log(`  codes blanked           : ${blankedCount}`);
  console.log(`  codes still showing     : ${noMatch.length - blankedCount} NO_MATCH, ${missing.length - reports.filter((r) => r.bucket === "MISSING_FIELD" && r.blank).length} MISSING_FIELD (kept as plausible)`);
  console.log(`  untouched, already OK   : ${by("OK").length}`);
  console.log(`  cost columns written    : 0 (productCost / cost / vaPercent / quotedRate untouched)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
