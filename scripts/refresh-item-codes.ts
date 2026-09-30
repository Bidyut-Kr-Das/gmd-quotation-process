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
 *  - A code is NEVER blanked. If re-derivation finds no exact match, the
 *    existing code is kept and the item is reported.
 *  - No BOM gate, matching current app behaviour (gate is commented out in
 *    lib/gmdItemCodeLookup.ts).
 *
 * Dry run by default. Pass --apply to write.
 *
 * ---------------------------------------------------------------------------
 * CASCADE FUNCTIONS BELOW ARE DELIBERATE COPIES
 * ---------------------------------------------------------------------------
 * `localSyncAvailableBomIds` and `localMaybeUpdateProductCostFromNewCode` are
 * verbatim ports of the private helpers in `app/actions.ts:1289-1482`. They are
 * duplicated on purpose so this script can be run without touching the
 * "use server" module. If the logic in app/actions.ts changes, these MUST be
 * re-synced. That is the trade-off of leaving app/actions.ts untouched.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { syncGmdItemCodes, getDetailedItemCodeFailureReason } from "@/lib/gmdItemCodeLookup";
import { getCachedBomRows, getBomEntry, buildRmCostMap, DIRECT_M2M } from "@/lib/gmdBomCostLookup";
import { buildRawMaterialsCostMap } from "@/lib/gmd2to1CostLookup";
import { getDistinctBomIds, getNoUseBomIdSet } from "@/lib/verifyBomLookup";
import { getRmStockMap, getRmTypeMap } from "@/lib/directM2MStockLookup";
import { recalculateItem } from "@/lib/costCalculator";
import { isEnquiryFrozen } from "@/lib/oneClickAccess";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SYNC = !args.includes("--no-sync");
const KEEP_STALE_BOM = args.includes("--keep-stale-bom");
const TTY = process.stdout.isTTY;
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
};

const sep = (n = 78) => "-".repeat(n);
const dec = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Columns the BOM cascade is allowed to write. */
type BomPatch = Partial<
  Record<"bomId" | "bomType" | "rmItemCode" | "rmType" | "availableStock", string | null>
>;

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
// Verbatim port of app/actions.ts:1313-1482 (maybeUpdateProductCostFromNewCode)
// ---------------------------------------------------------------------------
async function localMaybeUpdateProductCostFromNewCode(
  itemId: string,
  newCode: string | null
): Promise<void> {
  if (!newCode) return;

  const preMeta = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: { bomId: true, costRefCode: true, productCost: true, availableStock: true, bomType: true },
  });
  const needProductCost = preMeta?.productCost == null;
  const needStock = !preMeta?.availableStock || preMeta.availableStock.trim() === "";
  const needBomType = !preMeta?.bomType;
  if (!needProductCost && !needStock && !needBomType) return;

  try {
    // First-class rule: bomId absent + costRefCode present -> direct GMDUpdateItem match
    if (!preMeta?.bomId && preMeta?.costRefCode?.trim()) {
      const refCode = preMeta.costRefCode.trim();
      const rawMap = await buildRawMaterialsCostMap([refCode]);
      const cost = rawMap.get(refCode);
      let fbStock: string | undefined;
      let fbRmType: string | undefined;
      {
        const stockMap = await getRmStockMap([refCode]);
        const v = stockMap.get(refCode);
        if (v !== undefined && v.trim() !== "") fbStock = v;
      }
      {
        const rmTypeMap = await getRmTypeMap([refCode]);
        const v = rmTypeMap.get(refCode);
        if (v !== undefined) fbRmType = v;
      }
      const hasMatch = cost !== undefined || fbStock !== undefined || fbRmType !== undefined;
      if (hasMatch) {
        if (needProductCost && cost !== undefined && cost !== null) {
          await recalculateItem(itemId, { productCost: cost });
        }
        const data: BomPatch = {};
        if (fbRmType !== undefined) data.rmType = fbRmType;
        if (needStock && fbStock !== undefined) data.availableStock = fbStock;
        if (Object.keys(data).length > 0) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data });
        }
        return;
      }
      // No GMDUpdateItem match -> fall through to normal BOM logic
    }

    const candidateIds = await localSyncAvailableBomIds(itemId, newCode);
    if (candidateIds.length > 1) return;

    if (candidateIds.length === 1) {
      const vbRow = await prisma.verifyBom.findFirst({
        where: { itemCode: newCode, bomId: candidateIds[0] },
        select: { bomId: true, rmItemCode: true, bomIdType: true },
      });
      if (vbRow?.rmItemCode) {
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
          cost = rawMap.get(vbRow.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
            cost = supplyMap.get(vbRow.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        const bomType = vbRow.bomIdType || DIRECT_M2M;
        const dataToUpdate: BomPatch = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
        {
          const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (bomType === DIRECT_M2M && needStock) {
          const stockMap = await getRmStockMap([vbRow.rmItemCode]);
          const stock = stockMap.get(vbRow.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
        }
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });
        }
        return;
      }
    }

    // Fallback to sheet DIRECT M2M BOM
    {
      const bom = await getBomEntry(newCode);
      if (bom) {
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([bom.rmItemCode]);
          cost = rawMap.get(bom.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([bom.rmItemCode]);
            cost = supplyMap.get(bom.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        const dataToUpdate: BomPatch = { bomId: bom.bomId, rmItemCode: bom.rmItemCode, bomType: DIRECT_M2M };
        {
          const rmTypeMap = await getRmTypeMap([bom.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(bom.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (needStock) {
          const stockMap = await getRmStockMap([bom.rmItemCode]);
          const stock = stockMap.get(bom.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
          else delete dataToUpdate.availableStock;
        }
        if (!needStock) delete dataToUpdate.availableStock;
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });
        }
        return;
      }
    }

    if (candidateIds.length !== 0) return;

    // Final fallback: bomId absent -> direct GMDUpdateItem match on costRefCode
    const fallbackMeta = preMeta;
    if (fallbackMeta?.bomId) return;
    const fallbackCode = fallbackMeta?.costRefCode?.trim();
    if (!fallbackCode) return;
    let fallbackCost: number | undefined;
    let fbStock: string | undefined;
    let fbRmType: string | undefined;
    {
      const rawMap = await buildRawMaterialsCostMap([fallbackCode]);
      fallbackCost = rawMap.get(fallbackCode);
    }
    {
      const stockMap = await getRmStockMap([fallbackCode]);
      const stockVal = stockMap.get(fallbackCode);
      if (stockVal !== undefined && stockVal.trim() !== "") fbStock = stockVal;
    }
    {
      const rmTypeMap = await getRmTypeMap([fallbackCode]);
      const rt = rmTypeMap.get(fallbackCode);
      if (rt !== undefined) fbRmType = rt;
    }
    if (needProductCost && fallbackCost !== undefined && fallbackCost !== null) {
      await recalculateItem(itemId, { productCost: fallbackCost });
    }
    const fallbackData: BomPatch = {};
    if (fbRmType !== undefined) fallbackData.rmType = fbRmType;
    if (needStock && fbStock !== undefined) fallbackData.availableStock = fbStock;
    if (Object.keys(fallbackData).length > 0) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: fallbackData });
    }
  } catch (e) {
    console.warn(`[maybeUpdateProductCost] failed for ${itemId} code=${newCode}:`, e);
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
      reports.push({ bucket: "MISSING_FIELD", row, expected: null, phantom, reason: `Missing field(s): ${missing}` });
      continue;
    }

    const expected = await expectedCodeFor(row);
    if (expected === null) {
      reports.push({
        bucket: "NO_MATCH",
        row,
        expected: null,
        phantom,
        reason: await getDetailedItemCodeFailureReason(row),
        looseMatch: await looseMatchFor(row),
      });
      continue;
    }
    if (expected === row.erpItemCode) {
      reports.push({ bucket: "OK", row, expected, phantom });
      continue;
    }
    if (row.frozen) {
      reports.push({ bucket: "SKIPPED_FROZEN", row, expected, phantom });
      continue;
    }
    reports.push({ bucket: "WOULD_CHANGE", row, expected, phantom });
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

  if (!APPLY) {
    console.log(`\n${sep()}`);
    console.log("DRY RUN. Nothing was written to EnquiryItem.");
    console.log("Re-run with --apply to persist. Options:");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --limit=50          # rehearse on 50");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --docket=GMD/2026-27/055");
    console.log("  npx tsx scripts/refresh-item-codes.ts --apply --keep-stale-bom     # do not clear stale bomId");
    console.log("  npx tsx scripts/refresh-item-codes.ts --no-sync                    # reuse current snapshot");
    await prisma.$disconnect();
    return;
  }

  // ---- Phase 4: apply ------------------------------------------------------
  console.log(`\n${sep()}\nAPPLYING ${changes.length} change(s)...\n`);
  // Pre-warm the sheet BOM cache so the per-item cascade does not refetch it.
  try {
    await getCachedBomRows();
  } catch {}
  let done = 0;
  let failed = 0;
  let frozenSkipped = 0;
  const applied: string[] = [];

  for (let i = 0; i < changes.length; i++) {
    const r = changes[i];
    const { id, erpItemCode: from } = { id: r.row.id, erpItemCode: r.row.erpItemCode };
    const to = r.expected!;
    if (TTY) {
      process.stdout.write(
        `\r[${i + 1}/${changes.length}] ${r.row.docketNumber.padEnd(20)} ${from} -> ${to}`.padEnd(90)
      );
    }
    try {
      if (!KEEP_STALE_BOM && r.row.bomId && r.row.bomId !== "") {
        // The code changed, so any bomId/rmItemCode on this row belonged to the
        // OLD code. Clear it so the cascade re-derives cleanly from the new one.
        await prisma.enquiryItem.update({
          where: { id },
          data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
        });
      }
      await prisma.enquiryItem.update({ where: { id }, data: { erpItemCode: to } });
      await localSyncAvailableBomIds(id, to);
      if (r.row.frozen) {
        // erpItemCode/availableBomIds are not frozen fields, but recalculateItem
        // rewrites cost/quotedRate which are. Stop here.
        frozenSkipped++;
      } else {
        await localMaybeUpdateProductCostFromNewCode(id, to);
      }
      applied.push(id);
      done++;
    } catch (e) {
      failed++;
      console.log(`\n  FAILED ${id}: ${(e as Error).message}`);
    }
  }

  if (TTY) process.stdout.write(`\r${" ".padEnd(100)}\r`);
  console.log(`\n=== DONE ===`);
  console.log(`  codes changed : ${done}`);
  console.log(`  failed        : ${failed}`);
  console.log(`  frozen, cost cascade skipped: ${frozenSkipped}`);
  console.log(`  left untouched: ${noMatch.length} NO_MATCH, ${missing.length} MISSING_FIELD, ${by("OK").length} OK`);
  console.log(`  NOTE: ${phantomAll.length} phantom-code item(s) and ${misassigned.length} mis-assigned item(s) still need manual review - see the report.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
