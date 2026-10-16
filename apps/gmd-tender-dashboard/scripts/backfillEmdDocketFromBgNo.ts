/**
 * Bidirectional backfill via exact match emd_merged.bgNo === tender_merged.bgNoUtrNo
 * EMD -> Tender: emd_merged.status -> tender_merged.bgStatus
 *              emd_merged.bgDate -> tender_merged.bgDate
 *              emd_merged.expiryDate -> tender_merged.bgExpiryDate
 * Tender -> EMD: tender_merged.docketNo -> emd_merged.docketNo
 *              tender_merged.bgStatus -> emd_merged.status
 *              tender_merged.bgDate -> emd_merged.bgDate
 *              tender_merged.bgExpiryDate -> emd_merged.expiryDate
 * Policy: exact match (trim only, no normalization), fill blanks only - never overwrite
 * Usage: npx tsx scripts/backfillEmdDocketFromBgNo.ts [--dryRun] [--verbose]
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import pLimit from "p-limit";

const DRY_RUN = process.argv.includes("--dryRun");
const VERBOSE = process.argv.includes("--verbose");

function isBlank(v: string | null | undefined): boolean {
  return !v || String(v).trim() === "";
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Bidirectional backfill via exact match emd_merged.bgNo === tender_merged.bgNoUtrNo");
  console.log(`  Mode: ${DRY_RUN ? "DRY_RUN (no writes)" : "LIVE"}`);
  console.log("  Policy: fill blanks only (never overwrite NOT NULL / non-empty)");
  console.log("  EMD->Tender: status->bgStatus, bgDate->bgDate, expiryDate->bgExpiryDate");
  console.log("  Tender->EMD: docketNo->docketNo, bgStatus->status, bgDate->bgDate, bgExpiryDate->expiryDate");
  console.log("=".repeat(60));

  // --- Load EMD rows (need bgNo + fields for both directions) ---
  const emdRows = await prisma.emdMerged.findMany({
    where: { bgNo: { not: null } },
    select: { id: true, bgNo: true, status: true, bgDate: true, expiryDate: true, docketNo: true },
  });

  // --- Load Tender rows ---
  const tenderRows = await prisma.tenderMerged.findMany({
    where: { bgNoUtrNo: { not: null } },
    select: { id: true, bgNoUtrNo: true, bgStatus: true, bgDate: true, bgExpiryDate: true, docketNo: true },
  });

  // --- Build EMD map for EMD->Tender (key = exact trimmed bgNo) ---
  const emdMap = new Map<string, { id: string; bgNo: string; status: string | null; bgDate: string | null; expiryDate: string | null }>();
  const duplicateEmdBg = new Set<string>();
  let emdEmptyBg = 0;
  let emdNoUsableFields = 0;

  for (const r of emdRows) {
    const rawBg = (r.bgNo ?? "").trim();
    if (!rawBg) { emdEmptyBg++; continue; }
    const key = rawBg;
    const hasUsable = !isBlank(r.status) || !isBlank(r.bgDate) || !isBlank(r.expiryDate);
    if (!hasUsable) { emdNoUsableFields++; continue; }
    if (emdMap.has(key)) {
      duplicateEmdBg.add(key);
      continue;
    }
    emdMap.set(key, {
      id: r.id,
      bgNo: rawBg,
      status: r.status?.trim() ? r.status.trim() : null,
      bgDate: r.bgDate?.trim() ? r.bgDate.trim() : null,
      expiryDate: r.expiryDate?.trim() ? r.expiryDate.trim() : null,
    });
  }
  duplicateEmdBg.forEach((dup) => emdMap.delete(dup));

  console.log(`  emd_merged with bgNo: ${emdRows.length}`);
  console.log(`  emd usable for EMD->Tender (unique bg + at least 1 field): ${emdMap.size}`);
  console.log(`  skipped empty bgNo: ${emdEmptyBg}`);
  console.log(`  skipped no usable fields (all 3 blank): ${emdNoUsableFields}`);
  console.log(`  duplicate emd bgNo (skipped): ${duplicateEmdBg.size}`);
  if (VERBOSE && duplicateEmdBg.size > 0) {
    const dupArr = Array.from(duplicateEmdBg);
    console.log(`  duplicate emd bgNo: ${dupArr.slice(0, 20).join(", ")}${duplicateEmdBg.size > 20 ? " ..." : ""}`);
  }

  // --- Build Tender map for Tender->EMD (key = exact trimmed bgNoUtrNo) ---
  const tenderMap = new Map<string, { id: number; bgNoUtrNo: string; docketNo: string | null; bgStatus: string | null; bgDate: string | null; bgExpiryDate: string | null }>();
  const duplicateTenderBg = new Set<string>();
  let tenderEmptyBg = 0;
  let tenderNoUsableFields = 0;

  for (const t of tenderRows) {
    const rawBg = (t.bgNoUtrNo ?? "").trim();
    if (!rawBg) { tenderEmptyBg++; continue; }
    const key = rawBg;
    const hasUsable = !isBlank(t.docketNo) || !isBlank(t.bgStatus) || !isBlank(t.bgDate) || !isBlank(t.bgExpiryDate);
    if (!hasUsable) { tenderNoUsableFields++; continue; }
    if (tenderMap.has(key)) {
      duplicateTenderBg.add(key);
      continue;
    }
    tenderMap.set(key, {
      id: t.id,
      bgNoUtrNo: rawBg,
      docketNo: !isBlank(t.docketNo) ? String(t.docketNo).trim() : null,
      bgStatus: !isBlank(t.bgStatus) ? String(t.bgStatus).trim() : null,
      bgDate: !isBlank(t.bgDate) ? String(t.bgDate).trim() : null,
      bgExpiryDate: !isBlank(t.bgExpiryDate) ? String(t.bgExpiryDate).trim() : null,
    });
  }
  duplicateTenderBg.forEach((dup) => tenderMap.delete(dup));

  console.log(`  tender_merged with bgNoUtrNo: ${tenderRows.length}`);
  console.log(`  tender usable for Tender->EMD (unique bg + at least 1 field): ${tenderMap.size}`);
  console.log(`  skipped empty bgNoUtrNo: ${tenderEmptyBg}`);
  console.log(`  skipped tender no usable fields (all 4 blank): ${tenderNoUsableFields}`);
  console.log(`  duplicate tender bgNoUtrNo (skipped): ${duplicateTenderBg.size}`);
  if (VERBOSE && duplicateTenderBg.size > 0) {
    const dupArr = Array.from(duplicateTenderBg);
    console.log(`  duplicate tender bgNo: ${dupArr.slice(0, 20).join(", ")}${duplicateTenderBg.size > 20 ? " ..." : ""}`);
  }

  // --- Compute Tender updates (EMD->Tender) per-field blank check ---
  let tenderSkippedEmpty = 0;
  let tenderNoMatch = 0;
  let tenderMatched = 0;
  let tenderUnchanged = 0;
  const tenderUpdates: {
    id: number;
    bgNoUtrNo: string;
    key: string;
    data: Record<string, string>;
    emdId: string;
  }[] = [];

  for (const t of tenderRows) {
    const rawBg = (t.bgNoUtrNo ?? "").trim();
    if (!rawBg) { tenderSkippedEmpty++; continue; }
    const key = rawBg;
    const hit = emdMap.get(key);
    if (!hit) { tenderNoMatch++; continue; }
    tenderMatched++;

    const data: Record<string, string> = {};
    if (isBlank(t.bgStatus) && !isBlank(hit.status)) data.bgStatus = hit.status!;
    if (isBlank(t.bgDate) && !isBlank(hit.bgDate)) data.bgDate = hit.bgDate!;
    if (isBlank(t.bgExpiryDate) && !isBlank(hit.expiryDate)) data.bgExpiryDate = hit.expiryDate!;

    if (Object.keys(data).length === 0) { tenderUnchanged++; continue; }
    tenderUpdates.push({ id: t.id, bgNoUtrNo: rawBg, key, data, emdId: hit.id });
  }

  // --- Compute EMD updates (Tender->EMD) per-field blank check ---
  let emdSkippedEmpty = 0;
  let emdNoMatch = 0;
  let emdMatched = 0;
  let emdUnchanged = 0;
  const emdUpdates: { id: string; bgNo: string; key: string; data: Record<string, string>; tenderId: number }[] = [];

  for (const e of emdRows) {
    const rawBg = (e.bgNo ?? "").trim();
    if (!rawBg) { emdSkippedEmpty++; continue; }
    const key = rawBg;
    const hit = tenderMap.get(key);
    if (!hit) { emdNoMatch++; continue; }
    emdMatched++;

    const data: Record<string, string> = {};
    if (isBlank(e.docketNo) && !isBlank(hit.docketNo)) data.docketNo = hit.docketNo!;
    if (isBlank(e.status) && !isBlank(hit.bgStatus)) data.status = hit.bgStatus!;
    if (isBlank(e.bgDate) && !isBlank(hit.bgDate)) data.bgDate = hit.bgDate!;
    if (isBlank(e.expiryDate) && !isBlank(hit.bgExpiryDate)) data.expiryDate = hit.bgExpiryDate!;

    if (Object.keys(data).length === 0) { emdUnchanged++; continue; }
    emdUpdates.push({ id: e.id, bgNo: rawBg, key, data, tenderId: hit.id });
  }

  console.log("-".repeat(60));
  console.log("  EMD->Tender (bg fields):");
  console.log(`    skipped empty bgNoUtrNo: ${tenderSkippedEmpty}`);
  console.log(`    noMatch: ${tenderNoMatch}`);
  console.log(`    matched tenders: ${tenderMatched}`);
  console.log(`    already filled (unchanged): ${tenderUnchanged}`);
  console.log(`    to update tenders: ${tenderUpdates.length}`);
  console.log("  Tender->EMD (docketNo/status/bgDate/expiryDate):");
  console.log(`    skipped empty bgNo: ${emdSkippedEmpty}`);
  console.log(`    already filled (unchanged): ${emdUnchanged}`);
  console.log(`    noMatch: ${emdNoMatch}`);
  console.log(`    matched emd: ${emdMatched}`);
  console.log(`    to update emd: ${emdUpdates.length}`);

  if (tenderUpdates.length === 0 && emdUpdates.length === 0) {
    console.log("  Nothing to update.");
    await prisma.$disconnect();
    return;
  }

  if (VERBOSE) {
    if (tenderUpdates.length > 0) {
      console.log("  [EMD->Tender samples]");
      for (const u of tenderUpdates.slice(0, 10)) {
        const fields = Object.entries(u.data).map(([k, v]) => `${k}="${v}"`).join(", ");
        console.log(`    tender ${u.id} bgNoUtrNo="${u.bgNoUtrNo}" <- emd ${u.emdId} { ${fields} }`);
      }
      if (tenderUpdates.length > 10) console.log(`    ... and ${tenderUpdates.length - 10} more`);
    }
    if (emdUpdates.length > 0) {
      console.log("  [Tender->EMD samples]");
      for (const u of emdUpdates.slice(0, 10)) {
        const fields = Object.entries(u.data).map(([k, v]) => `${k}="${v}"`).join(", ");
        console.log(`    emd ${u.id} bgNo="${u.bgNo}" <- tender ${u.tenderId} { ${fields} }`);
      }
      if (emdUpdates.length > 10) console.log(`    ... and ${emdUpdates.length - 10} more`);
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY_RUN] would update ${tenderUpdates.length} tender rows + ${emdUpdates.length} emd rows`);
    if (tenderUpdates.length > 0) {
      const fieldCounts: Record<string, number> = {};
      for (const u of tenderUpdates) for (const k of Object.keys(u.data)) fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
      console.log(`  tender fields to fill: ${Object.entries(fieldCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    if (emdUpdates.length > 0) {
      const fieldCounts: Record<string, number> = {};
      for (const u of emdUpdates) for (const k of Object.keys(u.data)) fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
      console.log(`  emd fields to fill: ${Object.entries(fieldCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    await prisma.$disconnect();
    return;
  }

  const limit = pLimit(10);
  let tenderUpdated = 0;
  let tenderErrors = 0;
  let emdUpdated = 0;
  let emdErrors = 0;

  if (tenderUpdates.length > 0) {
    await Promise.all(
      tenderUpdates.map((u) =>
        limit(async () => {
          try {
            await prisma.tenderMerged.update({ where: { id: u.id }, data: u.data });
            tenderUpdated++;
          } catch (e: any) {
            tenderErrors++;
            console.warn(`  Failed tender ${u.id}: ${e.message}`);
          }
        })
      )
    );
  }

  if (emdUpdates.length > 0) {
    await Promise.all(
      emdUpdates.map((u) =>
        limit(async () => {
          try {
            await prisma.emdMerged.update({ where: { id: u.id }, data: u.data });
            emdUpdated++;
          } catch (e: any) {
            emdErrors++;
            console.warn(`  Failed emd ${u.id}: ${e.message}`);
          }
        })
      )
    );
  }

  console.log("-".repeat(60));
  console.log(`  Tender updated: ${tenderUpdated}/${tenderUpdates.length} errors=${tenderErrors}`);
  console.log(`  EMD updated: ${emdUpdated}/${emdUpdates.length} errors=${emdErrors}`);
  console.log("  Done.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[backfillEmdDocketFromBgNo] Fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});
