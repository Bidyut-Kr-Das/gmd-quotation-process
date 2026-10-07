/**
 * Migrate EmdDetailsBG + EmdDetailsCash -> EmdMerged
 * Usage: npx tsx scripts/migrateEmdToMerged.ts [--dryRun] [--skipRelation]
 * Assumes emd_merged is empty, no truncate, no legacy ids.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import pLimit from "p-limit";
import { randomUUID } from "crypto";

const DRY_RUN = process.argv.includes("--dryRun");
const SKIP_RELATION = process.argv.includes("--skipRelation");
const BATCH = 1000;

function normalizeDocketNo(v: string | null | undefined): string | null {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().toLowerCase();
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Migrate EMD -> EmdMerged");
  if (DRY_RUN) console.log("  [DRY RUN] no writes");
  console.log("=".repeat(60));

  // First delete many (clear table + implicit join)
  const existing = await prisma.emdMerged.count();
  console.log(`  Existing emd_merged rows: ${existing}`);
  if (DRY_RUN) {
    console.log(`  [DRY RUN] would delete ${existing} rows`);
  } else if (existing > 0) {
    // const del = await prisma.emdMerged.deleteMany();
    // console.log(`  Deleted ${del.count} existing rows`);
  }

  const bgRows = await prisma.emdDetailsBG.findMany();
  const cashRows = await prisma.emdDetailsCash.findMany();
  console.log(`  BG rows: ${bgRows.length}, Cash rows: ${cashRows.length}`);

  // Map BG -> EmdMerged
  const bgMapped = bgRows.map((r: any) => ({
    id: randomUUID(),
    emdType: "BG",
    tenderNo: r.tenderNo ?? null,
    tmNo: r.tmNo ?? null,
    remarks: r.remarks ?? null,
    contactEmailId: r.contactEmailId ?? null,
    emailDraft: r.emailDraft ?? null,
    lastEmailSent: r.lastEmailSent ?? null,
    lastEmailSentAt: r.lastEmailSentAt ?? null,
    reason: r.reason ?? null,
    contactNo: r.contactNo ?? null,
    address: r.address ?? null,
    docketNo: r.docketNo ?? null,
    bgNo: r.bgNo ?? null,
    customerName: r.partyName ?? null,
    bgAmtLocal: r.bgAmtLocal ?? null,
    bgAmtFc: r.bgAmtFc ?? null,
    bgDate: r.bgDate ?? null,
    expiryDate: r.expiryDate ?? null,
    claimDate: r.claimDate ?? null,
    // cash-only / shared nulls for BG
    emdAmt: null,
    issueDt: null,
    expectedRefundDateOrRefundedDate: null,
    // BG only
    trantype: r.trantype ?? null,
    bankName: r.bankName ?? null,
    partyCode: r.partyCode ?? null,
    staffName: r.staffName ?? null,
    status: r.status ?? null,
    match: r.match ?? null,
    bgMatch: r.bgMatch ?? null,
    statusPriceAssDone: r.statusPriceAssDone ?? null,
  }));

  // Map Cash -> EmdMerged
  const cashMapped = cashRows.map((r: any) => ({
    id: randomUUID(),
    emdType: "CASH",
    tenderNo: r.tenderNo ?? null,
    tmNo: r.tmNo ?? null,
    remarks: r.remarks ?? null,
    contactEmailId: r.contactEmailId ?? null,
    emailDraft: r.emailDraft ?? null,
    lastEmailSent: null,
    lastEmailSentAt: r.lastEmailSentAt ?? null,
    reason: r.reason ?? null,
    contactNo: null,
    address: null,
    docketNo: null,
    bgNo: null,
    customerName: r.customerName ?? null,
    emdAmt: r.emdAmt ?? null,
    bgAmtLocal: null,
    bgAmtFc: null,
    bgDate: null,
    expiryDate: null,
    claimDate: null,
    issueDt: r.issueDt ?? null,
    expectedRefundDateOrRefundedDate: r.expectedRefundDateOrRefundedDate ?? null,
    // BG only nulls
    trantype: null,
    bankName: null,
    partyCode: null,
    staffName: null,
    status: null,
    match: null,
    bgMatch: null,
    statusPriceAssDone: null,
    // Cash only
    permanent: r.permanent ?? null,
    chDdNo: r.chDdNo ?? null,
    acHolder: r.acHolder ?? null,
    statusAsPerSujibDaAndOther: r.statusAsPerSujibDaAndOther ?? null,
    canBeRefunded: r.canBeRefunded ?? null,
    rank: r.rank ?? null,
    poIssueStatus: r.poIssueStatus ?? null,
    aocAwardOfContractStatus: r.aocAwardOfContractStatus ?? null,
    refundableOrNot: r.refundableOrNot ?? null,
    statusRefundedPending: r.statusRefundedPending ?? null,
    statusOfTender: r.statusOfTender ?? null,
    conditionsForRefund: r.conditionsForRefund ?? null,
    certificateByParty: r.certificateByParty ?? null,
    certificateByUtility: r.certificateByUtility ?? null,
  }));

  const all = [...bgMapped, ...cashMapped];
  console.log(`  Mapped total: ${all.length} (BG ${bgMapped.length} + Cash ${cashMapped.length})`);

  if (DRY_RUN) {
    console.log("  [DRY RUN] would insert:", all.length);
  } else {
    let inserted = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      const res = await prisma.emdMerged.createMany({ data: batch as any });
      inserted += res.count;
      console.log(`  Inserted batch ${i / BATCH + 1}: ${res.count}`);
    }
    console.log(`  Total inserted: ${inserted} / ${all.length}`);
  }

  if (SKIP_RELATION) {
    console.log("  Skipping relation population (--skipRelation)");
    await prisma.$disconnect();
    return;
  }

  // Populate M:N via docketNo
  console.log("-".repeat(60));
  console.log("  Populating M:N tenderMergeds via docketNo...");

  // Need fresh ids if dryRun -> use mapped ids, else fetch from DB
  let emdRowsForRelation: { id: string; docketNo: string | null }[];
  if (DRY_RUN) {
    emdRowsForRelation = all
      .filter((r) => r.docketNo)
      .map((r) => ({ id: r.id, docketNo: r.docketNo }));
  } else {
    emdRowsForRelation = await prisma.emdMerged.findMany({
      select: { id: true, docketNo: true },
      where: { docketNo: { not: null } },
    });
  }

  const tenderRows = await prisma.tenderMerged.findMany({
    select: { id: true, docketNo: true },
    where: { docketNo: { not: null } },
  });

  const tenderByDocket = new Map<string, number[]>();
  for (const t of tenderRows) {
    const norm = normalizeDocketNo(t.docketNo);
    if (!norm) continue;
    const arr = tenderByDocket.get(norm) ?? [];
    arr.push(t.id);
    tenderByDocket.set(norm, arr);
  }

  console.log(`  TenderMerged with docketNo: ${tenderRows.length}, unique dockets: ${tenderByDocket.size}`);
  console.log(`  EmdMerged with docketNo: ${emdRowsForRelation.length}`);

  let linked = 0;
  let noMatch = 0;
  let multiMatch = 0;
  const limit = pLimit(10);
  const tasks: Promise<void>[] = [];

  for (const emd of emdRowsForRelation) {
    const norm = normalizeDocketNo(emd.docketNo);
    if (!norm) continue;
    const tenderIds = tenderByDocket.get(norm);
    if (!tenderIds || tenderIds.length === 0) {
      noMatch++;
      continue;
    }
    if (tenderIds.length > 1) multiMatch++;
    linked++;

    if (DRY_RUN) continue;

    tasks.push(
      limit(async () => {
        try {
          await prisma.emdMerged.update({
            where: { id: emd.id },
            data: { tenderMergeds: { connect: tenderIds.map((id) => ({ id })) } },
          });
        } catch (e: any) {
          console.warn(`  Failed link emd ${emd.id} docket ${emd.docketNo}: ${e.message}`);
        }
      })
    );
  }

  if (tasks.length) await Promise.all(tasks);

  console.log(`  Relation done: linked ${linked}, noMatch ${noMatch}, multiMatch ${multiMatch}`);
  console.log("-".repeat(60));
  console.log("  Done.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[migrateEmdToMerged] Fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});
