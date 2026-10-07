/**
 * Migration Script: Merge GemTender and NonGemTender into TenderMerged
 *
 * Usage: cd v2 && npx tsx scripts/migrate-to-tender-merged.ts
 *
 * This script:
 * 1. Creates TenderMerged records from GemTender and NonGemTender data
 * 2. Updates TenderMerged records to connect existing junction table records
 *
 * NO delete operations - all original data is preserved
 */
import { prisma } from "../lib/prisma";
import { TenderType } from "../generated/prisma/client";

interface TenderMapping {
  originalId: number;
  tenderType: TenderType;
  tenderMergedId: number;
}

async function main() {
  console.log("=== Starting TenderMerged Migration ===\n");

  const stats = {
    gemTendersCreated: 0,
    nonGemTendersCreated: 0,
    extraFieldsLinked: 0,
    associationsLinked: 0,
    reportingsLinked: 0,
    evaluationsLinked: 0,
    errors: 0,
  };

  const tenderMapping: TenderMapping[] = [];

  console.log("[Phase 1] Creating TenderMerged records...\n");

  // -------- GEM Tenders --------
  console.log("  Processing GemTenders...");
  const gemTenders = await prisma.gemTender.findMany({
    include: {
      extraFields: { select: { id: true } },
      tenderAssociations: { select: { id: true } },
      reportings: { select: { id: true } },
      evaluations: { select: { id: true } },
    },
  });
  console.log(`    Found ${gemTenders.length} GemTender records`);

  for (const gt of gemTenders) {
    try {
      const created = await prisma.tenderMerged.create({
        data: {
          tenderType: "GEM",
          originalId: gt.id,
          referenceNo: gt.referenceNo,
          tenderBrief: gt.tenderBrief,
          deadline: gt.deadline,
          location: gt.location,
          organization: gt.organization,
          documentFees: gt.documentFees,
          emd: gt.emd,
          msmeExemption: gt.msmeExemption,
          startupExemption: gt.startupExemption,
          quantity: gt.quantity,
          checklist: gt.checklist,
          t247Id: gt.t247Id,
          scrapedDate: gt.scrapedDate,
          source: gt.source,
          assignedTo: gt.assignedTo,
          markedStatus: gt.markedStatus,
          sheetStatus: gt.sheetStatus,
          ready: gt.ready,
          searchKey: gt.searchKey,
          downloadLink: gt.downloadLink,
          currency: gt.currency,
          excludedCategory: gt.excludedCategory,
          aiRelevanceValid: gt.aiRelevanceValid,
          aiRelevanceReason: gt.aiRelevanceReason,
          tenderFileUrl: gt.tenderFileUrl,
          docketNo: gt.docketNo,
          attachmentUrl: gt.attachmentUrl,
          remarks: gt.remarks,
          app: gt.app,
          aps: gt.aps,
          apm: gt.apm,
          state: gt.state,
          website: gt.website,
          locationCount: gt.locationCount,
          value: gt.value,
          bidOpeningDateTime: gt.bidOpeningDateTime,
          bidOfferValidity: gt.bidOfferValidity,
          ministryStateName: gt.ministryStateName,
          departmentName: gt.departmentName,
          officeName: gt.officeName,
          minimumAverageAnnualTurnover: gt.minimumAverageAnnualTurnover,
          yearsOfPastExperience: gt.yearsOfPastExperience,
          oemAverageTurnover: gt.oemAverageTurnover,
          contractPeriod: gt.contractPeriod,
          financialDocumentPriceBreakupRequired: gt.financialDocumentPriceBreakupRequired,
          similarCategory: gt.similarCategory,
          pastExperienceSimilarServicesRequired: gt.pastExperienceSimilarServicesRequired,
          documentRequiredFromSeller: gt.documentRequiredFromSeller,
          pastPerformance: gt.pastPerformance,
          bidToRaEnabled: gt.bidToRaEnabled,
          raQualificationRule: gt.raQualificationRule,
          boqTitle: gt.boqTitle,
          bidDetails: gt.bidDetails,
          comprehensiveMaintenanceChargesRequired: gt.comprehensiveMaintenanceChargesRequired,
          typeOfBid: gt.typeOfBid,
          technicalClarificationTimeAllowed: gt.technicalClarificationTimeAllowed,
          inspectionRequired: gt.inspectionRequired,
          estimatedBidValue: gt.estimatedBidValue,
          evaluationMethod: gt.evaluationMethod,
          advisoryBank: gt.advisoryBank,
          ePbgPercentage: gt.ePbgPercentage,
          ePbgDurationMonths: gt.ePbgDurationMonths,
          msePurchasePreference: gt.msePurchasePreference,
          miiPurchasePreference: gt.miiPurchasePreference,
          consigneesReportingOfficer: gt.consigneesReportingOfficer,
          mediationClause: gt.mediationClause,
          arbitrationClause: gt.arbitrationClause,
          itemCategory: gt.itemCategory,
          totalQuantity: gt.totalQuantity,
          bidStatus: gt.bidStatus,
          differenceBetweenRank1: gt.differenceBetweenRank1,
          nameOfRank1: gt.nameOfRank1,
          valueOfRank1: gt.valueOfRank1,
          differenceBetweenRank2: gt.differenceBetweenRank2,
          nameOfRank2: gt.nameOfRank2,
          valueOfRank2: gt.valueOfRank2,
          evaluationTableData: gt.evaluationTableData,
          parseStatus: gt.parseStatus,
          parseError: gt.parseError,
          resultAutomationStatus: gt.resultAutomationStatus,
          resultAutomationError: gt.resultAutomationError,
          fileId: gt.fileId,
          tenderStatusId: gt.tenderStatusId,
          utilityMappingId: gt.utilityMappingId,
        },
      });

      tenderMapping.push({
        originalId: gt.id,
        tenderType: "GEM",
        tenderMergedId: created.id,
      });
      stats.gemTendersCreated++;
    } catch (err) {
      console.error(`    [ERR] GemTender ${gt.id}: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  console.log(`    Created ${stats.gemTendersCreated} TenderMerged records from GemTenders\n`);

  // -------- NonGem Tenders --------
  console.log("  Processing NonGemTenders...");
  const nonGemTenders = await prisma.nonGemTender.findMany({
    include: {
      extraFields: { select: { id: true } },
      tenderAssociations: { select: { id: true } },
    },
  });
  console.log(`    Found ${nonGemTenders.length} NonGemTender records`);

  for (const ngt of nonGemTenders) {
    try {
      const created = await prisma.tenderMerged.create({
        data: {
          tenderType: "NON_GEM",
          originalId: ngt.id,
          referenceNo: ngt.referenceNo,
          tenderBrief: ngt.tenderBrief,
          deadline: ngt.deadline,
          location: ngt.location,
          organization: ngt.organization,
          documentFees: ngt.documentFees,
          emd: ngt.emd,
          msmeExemption: ngt.msmeExemption,
          startupExemption: ngt.startupExemption,
          quantity: ngt.quantity,
          checklist: ngt.checklist,
          t247Id: ngt.t247Id,
          scrapedDate: ngt.scrapedDate,
          source: ngt.source,
          assignedTo: ngt.assignedTo,
          markedStatus: ngt.markedStatus,
          sheetStatus: ngt.sheetStatus,
          ready: ngt.ready,
          searchKey: ngt.searchKey,
          downloadLink: ngt.downloadLink,
          currency: ngt.currency,
          excludedCategory: ngt.excludedCategory,
          aiRelevanceValid: ngt.aiRelevanceValid,
          aiRelevanceReason: ngt.aiRelevanceReason,
          tenderFileUrl: ngt.tenderFileUrl,
          docketNo: ngt.docketNo,
          attachmentUrl: ngt.attachmentUrl,
          remarks: ngt.remarks,
          app: ngt.app,
          aps: ngt.aps,
          apm: ngt.apm,
          state: ngt.state,
          website: ngt.website,
          locationCount: ngt.locationCount,
          estimatedBidValue: ngt.estimatedBidValue,
          fileId: ngt.fileId,
          tenderStatusId: ngt.tenderStatusId,
          utilityMappingId: ngt.utilityMappingId,
        },
      });

      tenderMapping.push({
        originalId: ngt.id,
        tenderType: "NON_GEM",
        tenderMergedId: created.id,
      });
      stats.nonGemTendersCreated++;
    } catch (err) {
      console.error(`    [ERR] NonGemTender ${ngt.id}: ${(err as Error).message}`);
      stats.errors++;
    }
  }
  console.log(`    Created ${stats.nonGemTendersCreated} TenderMerged records from NonGemTenders\n`);

  // ============================================
  // PHASE 2: Connect Junction Records
  // ============================================
  console.log("[Phase 2] Connecting junction table records...\n");

  const getTenderMergedId = (originalId: number, tenderType: TenderType): number | undefined => {
    return tenderMapping.find((m) => m.originalId === originalId && m.tenderType === tenderType)?.tenderMergedId;
  };

  // -------- TenderExtraField --------
  console.log("  Linking TenderExtraField records...");
  const extraFieldsWithSource = await prisma.tenderExtraField.findMany({
    where: {
      OR: [{ gemTenderId: { not: null } }, { nonGemTenderId: { not: null } }],
      tenderMergedId: null,
    },
  });

  for (const ef of extraFieldsWithSource) {
    const tenderMergedId = ef.gemTenderId
      ? getTenderMergedId(ef.gemTenderId, "GEM")
      : ef.nonGemTenderId
        ? getTenderMergedId(ef.nonGemTenderId, "NON_GEM")
        : undefined;

    if (tenderMergedId) {
      await prisma.tenderExtraField.update({
        where: { id: ef.id },
        data: { tenderMergedId },
      });
      stats.extraFieldsLinked++;
    }
  }
  console.log(`    Linked ${stats.extraFieldsLinked} TenderExtraField records\n`);

  // -------- TenderAssociation --------
  console.log("  Linking TenderAssociation records...");
  const associationsWithSource = await prisma.tenderAssociation.findMany({
    where: {
      OR: [{ gemTenderId: { not: null } }, { nonGemTenderId: { not: null } }],
      tenderMergedId: null,
    },
  });

  for (const ta of associationsWithSource) {
    const tenderMergedId = ta.gemTenderId
      ? getTenderMergedId(ta.gemTenderId, "GEM")
      : ta.nonGemTenderId
        ? getTenderMergedId(ta.nonGemTenderId, "NON_GEM")
        : undefined;

    if (tenderMergedId) {
      await prisma.tenderAssociation.update({
        where: { id: ta.id },
        data: { tenderMergedId },
      });
      stats.associationsLinked++;
    }
  }
  console.log(`    Linked ${stats.associationsLinked} TenderAssociation records\n`);

  // -------- Reporting (only GEM) --------
  console.log("  Linking Reporting records...");
  const reportingsWithSource = await prisma.reporting.findMany({
    where: { gemTenderId: { not: null }, tenderMergedId: null },
  });

  for (const r of reportingsWithSource) {
    const tenderMergedId = r.gemTenderId ? getTenderMergedId(r.gemTenderId, "GEM") : undefined;

    if (tenderMergedId) {
      await prisma.reporting.update({
        where: { id: r.id },
        data: { tenderMergedId },
      });
      stats.reportingsLinked++;
    }
  }
  console.log(`    Linked ${stats.reportingsLinked} Reporting records\n`);

  // -------- Evaluation (only GEM) --------
  console.log("  Linking Evaluation records...");
  const evaluationsWithSource = await prisma.evaluation.findMany({
    where: { gemTenderId: { not: null }, tenderMergedId: null },
  });

  for (const e of evaluationsWithSource) {
    const tenderMergedId = e.gemTenderId ? getTenderMergedId(e.gemTenderId, "GEM") : undefined;

    if (tenderMergedId) {
      await prisma.evaluation.update({
        where: { id: e.id },
        data: { tenderMergedId },
      });
      stats.evaluationsLinked++;
    }
  }
  console.log(`    Linked ${stats.evaluationsLinked} Evaluation records\n`);

  // ============================================
  // Summary
  // ============================================
  console.log("=== Migration Complete ===\n");
  console.log("Summary:");
  console.log(`  GemTenders migrated:        ${stats.gemTendersCreated}`);
  console.log(`  NonGemTenders migrated:     ${stats.nonGemTendersCreated}`);
  console.log(`  ExtraFields linked:         ${stats.extraFieldsLinked}`);
  console.log(`  Associations linked:         ${stats.associationsLinked}`);
  console.log(`  Reportings linked:           ${stats.reportingsLinked}`);
  console.log(`  Evaluations linked:         ${stats.evaluationsLinked}`);
  console.log(`  Errors:                     ${stats.errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
