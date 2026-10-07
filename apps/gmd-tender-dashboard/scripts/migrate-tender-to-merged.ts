/**
 * Migration Script: Migrate legacy Tender records into TenderMerged
 *
 * Usage: cd v2 && npx tsx scripts/migrate-tender-to-merged.ts
 *
 * - If tenderNoNitNo already exists as referenceNo → UPDATE that TenderMerged
 * - If not → CREATE a new TenderMerged record
 * - All records get assigned to a "Legacy Tenders" File record
 * - tenderPrepareBy → fuzzy match against Association table → TenderAssociation
 */
import { prisma } from "../lib/prisma";
import { Decision, TenderType } from "../generated/prisma/client";

function deriveTenderType(typeOfTender: string): TenderType {
  const upper = typeOfTender.toUpperCase();
  if (upper === "GEM" || upper === "GEM TENDER") return "GEM";
  return "NON_GEM";
}

function mapApm(decision: string): Decision {
  if (decision === "YES") return "YES";
  if (decision === "NO") return "NO";
  return "NOT_DECIDED";
}

function cleanDocketNo(docketNo: string): string | null {
  return docketNo === "-" ? null : docketNo;
}

function findMatchingAssociation(
  name: string,
  associations: { id: number; name: string }[],
): { id: number } | null {
  if (!name || name === "#N/A") return null;
  const lower = name.toLowerCase().trim();
  return (
    associations.find(
      (a) =>
        a.name.toLowerCase() === lower ||
        a.name.toLowerCase().includes(lower) ||
        lower.includes(a.name.toLowerCase()),
    ) ?? null
  );
}

async function main() {
  console.log("=== Migrating Tender → TenderMerged ===\n");

  // ── Step 1: Find or create Legacy File ──
  let file = await prisma.file.findFirst({
    where: { fileName: "Legacy Tenders" },
  });
  if (!file) {
    file = await prisma.file.create({
      data: {
        fileName: "Legacy Tenders",
        fileType: "legacy",
        status: "migrated",
      },
    });
  }
  const legacyFileId = file.id;
  console.log("Legacy File ID:", legacyFileId, "\n");

  // ── Step 2: Pre-load associations ──
  const allAssociations = await prisma.association.findMany({
    select: { id: true, name: true },
  });
  console.log("Loaded", allAssociations.length, "associations\n");

  // ── Step 3: Load Tender records ──
  const tenders = await prisma.tender.findMany({
    orderBy: { slNo: "asc" },
  });
  console.log("Total Tender records:", tenders.length, "\n");

  // ── Step 4: Build existing referenceNo set ──
  const existingRefs = new Set(
    (
      await prisma.tenderMerged.findMany({
        select: { referenceNo: true },
      })
    ).map((r) => r.referenceNo),
  );
  console.log("Existing TenderMerged referenceNos:", existingRefs.size, "\n");

  // ── Step 5: Migrate ──
  let created = 0;
  let updated = 0;
  let linked = 0;
  let linkSkipped = 0;
  let errors = 0;

  for (const t of tenders) {
    try {
      const exists = existingRefs.has(t.tenderNoNitNo);
      const apm = mapApm(t.managementDecision);
      const deadline = t.tenderSubmittedDate ?? t.lastDateOfSubmission;
      const docketNo = cleanDocketNo(t.docketNo);
      const tenderType = deriveTenderType(t.typeOfTender);

      // Build the data object (shared between create and update)
      const data = {
        // Mapped fields
        tenderBrief: t.nameOfWorkDescription,
        organization: t.nameOfTheClient,
        deadline,
        documentFees: t.costOfTenderFeeRs?.toString(),
        emd: t.emdAmountRs?.toString(),
        estimatedBidValue: t.estimatedCostRs?.toString(),
        totalQuantity: t.totalQuantityMeter?.toString(),
        docketNo,
        attachmentUrl: t.attachmentUrl,
        remarks: t.remarks,
        apm,
        tenderType,
        fileId: legacyFileId,

        // 25 new fields
        slNo: t.slNo,
        tenderFor: t.tenderFor,
        tenderOpeningDate: t.tenderOpeningDate,
        bidValidityDays: t.bidValidityDays,
        contractPeriodDays: t.contractPeriodDays,
        participated: t.participated,
        currentStatus: t.currentStatus,
        reverseAuctionApplicable: t.reverseAuctionApplicable,
        reverseAuctionDate: t.reverseAuctionDate,
        emdPaymentMode: t.emdPaymentMode,
        bgNoUtrNo: t.bgNoUtrNo,
        emdValidity: t.emdValidity,
        loiPoNoAndDate: t.loiPoNoAndDate,
        bidValidityExpired: t.bidValidityExpired,
        diffPercentFromL1: t.diffPercentFromL1,
        diffPercentFromL2: t.diffPercentFromL2,
        reason: t.reason,
        finalRemarks: t.finalRemarks,
        tenderUpdateStatus: t.tenderUpdateStatus,
        nextAction: t.nextAction,
        diffL1ManuallyEdited: t.diffL1ManuallyEdited,
        diffL2ManuallyEdited: t.diffL2ManuallyEdited,
        cva: t.cva,
        quotationNo: t.quotationNo,
        rawMaterials: t.rawMaterials,
      } as const;

      let tenderMergedId: number;

      if (exists) {
        // ── UPDATE path ──
        const existing = await prisma.tenderMerged.findUniqueOrThrow({
          where: { referenceNo: t.tenderNoNitNo },
        });
        await prisma.tenderMerged.update({
          where: { referenceNo: t.tenderNoNitNo },
          data,
        });
        tenderMergedId = existing.id;
        updated++;
      } else {
        // ── CREATE path ──
        const created_ = await prisma.tenderMerged.create({
          data: {
            ...data,
            referenceNo: t.tenderNoNitNo,
            originalId: null,
          },
        });
        tenderMergedId = created_.id;
        created++;
      }

      // ── Association linking ──
      const matchedAssoc = findMatchingAssociation(
        t.tenderPrepareBy,
        allAssociations,
      );
      if (matchedAssoc) {
        // Check if already linked (avoid duplicate key error)
        const alreadyLinked = await prisma.tenderAssociation.findFirst({
          where: {
            tenderMergedId,
            associationId: matchedAssoc.id,
          },
        });
        if (!alreadyLinked) {
          await prisma.tenderAssociation.create({
            data: {
              tenderMergedId,
              associationId: matchedAssoc.id,
            },
          });
          linked++;
        } else {
          linkSkipped++;
        }
      }
    } catch (err) {
      console.error(
        `  [ERR] ${t.tenderNoNitNo}: ${(err as Error).message}`,
      );
      errors++;
    }
  }

  // ── Summary ──
  console.log("\n=== Migration Complete ===");
  console.log("  Total Tender records:  ", tenders.length);
  console.log("  Created:               ", created);
  console.log("  Updated:               ", updated);
  console.log("  TenderAssociations:     ", linked);
  console.log("  Associations skipped:  ", linkSkipped);
  console.log("  Errors:                ", errors);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
