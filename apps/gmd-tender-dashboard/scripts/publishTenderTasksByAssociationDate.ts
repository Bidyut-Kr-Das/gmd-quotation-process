/**
 * Script to publish jobs to `tender:tasks` for tender_associations
 * whose createdAt falls on 22-08-2026 (IST).
 *
 * By default runs in dry-run mode (only logs counts).
 * Pass --publish to actually publish to RabbitMQ.
 *
 * Usage:
 *   npx tsx scripts/publishTenderTasksByAssociationDate.ts
 *   npx tsx scripts/publishTenderTasksByAssociationDate.ts --date=2026-08-22
 *   npx tsx scripts/publishTenderTasksByAssociationDate.ts --date=2026-08-22 --utc
 *   npx tsx scripts/publishTenderTasksByAssociationDate.ts --publish
 *   npx tsx scripts/publishTenderTasksByAssociationDate.ts --date=2026-08-22 --publish
 */
import { prisma } from "../lib/prisma";
import { publishTenderTask } from "../lib/queue/publisher";
import { closeConnection } from "../lib/rabbitmq";

function parseArgs() {
  const args = process.argv.slice(2);
  let dateStr = "2026-08-22";
  let useUtc = false;
  let shouldPublish = false;
  for (const a of args) {
    if (a.startsWith("--date=")) dateStr = a.split("=")[1];
    if (a === "--utc") useUtc = true;
    if (a === "--publish") shouldPublish = true;
  }
  return { dateStr, useUtc, shouldPublish };
}

function getDateBounds(dateStr: string, useUtc: boolean): { start: Date; end: Date } {
  if (useUtc) {
    const start = new Date(`${dateStr}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  // IST: Asia/Kolkata is UTC+05:30
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(start);
  // add 1 day
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function main() {
  const { dateStr, useUtc, shouldPublish } = parseArgs();
  const { start, end } = getDateBounds(dateStr, useUtc);

  console.log("=".repeat(60));
  console.log("  Publish tender:tasks by tender_association date");
  console.log("=".repeat(60));
  console.log(`\n  Target date: ${dateStr} (${useUtc ? "UTC" : "IST +05:30"})`);
  console.log(`  Bounds: gte ${start.toISOString()}  lt ${end.toISOString()}`);

  // Step 1: count raw associations on that date
  const totalAssociations = await prisma.tenderAssociation.count({
    where: { createdAt: { gte: start, lt: end } },
  });

  console.log(`\n  Total tender_associations on ${dateStr}: ${totalAssociations}`);

  if (totalAssociations === 0) {
    console.log("  No associations found for this date. Exiting.");
    return;
  }

  // Step 2: fetch associations with tender details
  const associations = await prisma.tenderAssociation.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: {
      id: true,
      createdAt: true,
      tenderMergedId: true,
      gemTenderId: true,
      nonGemTenderId: true,
      associationId: true,
      tenderMerged: {
        select: {
          id: true,
          referenceNo: true,
          tenderType: true,
          t247Id: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  // Deduplicated by tenderMergedId (the target for tender:tasks is TenderMerged id)
  const mergedIdSet = new Set<number>();
  const orphanGemIds: number[] = [];
  const orphanNonGemIds: number[] = [];
  let nullTenderCount = 0;

  for (const a of associations) {
    if (a.tenderMergedId) mergedIdSet.add(a.tenderMergedId);
    else if (a.gemTenderId) orphanGemIds.push(a.gemTenderId);
    else if (a.nonGemTenderId) orphanNonGemIds.push(a.nonGemTenderId);
    else nullTenderCount++;
  }

  const distinctMergedIds = [...mergedIdSet];

  console.log(`\n  Breakdown:`);
  console.log(`    Associations with tenderMergedId: ${distinctMergedIds.length} distinct / ${associations.filter((a) => a.tenderMergedId).length} total rows`);
  console.log(`    Orphan gemTenderId (no merged):   ${orphanGemIds.length}`);
  console.log(`    Orphan nonGemTenderId (no merged): ${orphanNonGemIds.length}`);
  console.log(`    No tender FK at all:               ${nullTenderCount}`);

  // Step 3: fetch merged tender details for distinct ids (to build publish payload)
  let tenders: { id: number; referenceNo: string; tenderType: string; t247Id: string | null }[] = [];
  if (distinctMergedIds.length > 0) {
    const fetched = await prisma.tenderMerged.findMany({
      where: { id: { in: distinctMergedIds } },
      select: { id: true, referenceNo: true, tenderType: true, t247Id: true },
    });
    tenders = fetched as typeof tenders;
  }

  // Partition by type
  const gemCount = tenders.filter((t) => t.tenderType === "GEM").length;
  const nonGemCount = tenders.filter((t) => t.tenderType === "NON_GEM").length;
  const missingRef = tenders.filter((t) => !t.referenceNo).length;

  console.log(`\n  Tenders to publish (distinct TenderMerged): ${tenders.length}`);
  console.log(`    GEM:     ${gemCount}`);
  console.log(`    NON_GEM: ${nonGemCount}`);
  console.log(`    Missing referenceNo (would be skipped on publish): ${missingRef}`);

  if (tenders.length > 0) {
    console.log(`\n  Sample (up to 20):`);
    for (const t of tenders.slice(0, 20)) {
      console.log(`    - id=${t.id} type=${t.tenderType} ref=${t.referenceNo} t247Id=${t.t247Id ?? "-"}`);
    }
    if (tenders.length > 20) console.log(`    ... and ${tenders.length - 20} more`);
  }

  // Step 4: publish (gated by --publish flag)
  if (!shouldPublish) {
    console.log(`\n  Publishing: DISABLED (dry-run). Pass --publish to push to tender:tasks.`);
  } else {
    console.log(`\n  Publishing: ENABLED (--publish) -> tender:tasks`);
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tenders) {
    if (!t.referenceNo) {
      console.warn(`  [SKIP] id=${t.id}: missing referenceNo`);
      skipped++;
      continue;
    }

    if (!shouldPublish) {
      // dry-run: just count
      queued++;
      continue;
    }

    try {
      const isGem = t.tenderType === "GEM";
      const payload = isGem
        ? {
            type: "GEM_DOWNLOAD" as const,
            tenderId: t.id,
            gemId: t.t247Id || t.referenceNo,
            referenceNo: t.referenceNo,
            timestamp: Date.now(),
          }
        : {
            type: "NON_GEM_DOWNLOAD" as const,
            tenderId: t.id,
            referenceNo: t.referenceNo,
            timestamp: Date.now(),
          };
      const ok = await publishTenderTask(payload);
      if (ok) {
        console.log(`  [OK] ${t.referenceNo} (${payload.type}) -> tender:tasks`);
        queued++;
      } else {
        console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERR] ${t.referenceNo}: ${(err as Error).message}`);
      failed++;
    }
  }

  if (shouldPublish) {
    console.log("\n  Results (publish enabled):");
  } else {
    console.log("\n  Results (dry-run / publish disabled):");
  }
  console.log(`    Total associations scanned: ${associations.length}`);
  console.log(`    Distinct TenderMerged to publish: ${tenders.length}`);
  console.log(`    ${shouldPublish ? "Queued" : "Would-be queued"} to tender:tasks: ${queued}`);
  console.log(`    Skipped (no ref): ${skipped}`);
  console.log(`    Failed: ${failed}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeConnection();
  });
