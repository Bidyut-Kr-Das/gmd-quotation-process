/*
  Warnings:

  - A unique constraint covering the columns `[tenderMergedId,associationId]` on the table `tender_associations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TenderType" AS ENUM ('GEM', 'NON_GEM');

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "tenderMergedId" INTEGER,
ALTER COLUMN "gemTenderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "reportings" ADD COLUMN     "tenderMergedId" INTEGER,
ALTER COLUMN "gemTenderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tender_associations" ADD COLUMN     "tenderMergedId" INTEGER;

-- AlterTable
ALTER TABLE "tender_extra_fields" ADD COLUMN     "tenderMergedId" INTEGER;

-- CreateTable
CREATE TABLE "tender_merged" (
    "id" SERIAL NOT NULL,
    "tenderType" "TenderType" NOT NULL,
    "originalId" INTEGER NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "tenderBrief" TEXT,
    "deadline" TIMESTAMP(3),
    "location" TEXT,
    "organization" TEXT,
    "documentFees" TEXT,
    "emd" TEXT,
    "msmeExemption" TEXT,
    "startupExemption" TEXT,
    "quantity" TEXT,
    "checklist" TEXT,
    "t247Id" TEXT,
    "scrapedDate" TEXT,
    "source" TEXT,
    "assignedTo" TEXT,
    "markedStatus" TEXT,
    "sheetStatus" TEXT,
    "ready" TEXT,
    "searchKey" TEXT,
    "downloadLink" TEXT,
    "currency" TEXT,
    "excludedCategory" TEXT,
    "aiRelevanceValid" BOOLEAN,
    "aiRelevanceReason" TEXT,
    "tenderFileUrl" TEXT,
    "docketNo" TEXT,
    "attachmentUrl" TEXT,
    "remarks" TEXT,
    "app" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "aps" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "apm" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "state" TEXT,
    "website" TEXT,
    "locationCount" INTEGER,
    "value" TEXT,
    "bidOpeningDateTime" TEXT,
    "bidOfferValidity" TEXT,
    "ministryStateName" TEXT,
    "departmentName" TEXT,
    "officeName" TEXT,
    "minimumAverageAnnualTurnover" TEXT,
    "yearsOfPastExperience" TEXT,
    "oemAverageTurnover" TEXT,
    "contractPeriod" TEXT,
    "financialDocumentPriceBreakupRequired" TEXT,
    "similarCategory" TEXT,
    "pastExperienceSimilarServicesRequired" TEXT,
    "documentRequiredFromSeller" TEXT,
    "pastPerformance" TEXT,
    "bidToRaEnabled" TEXT,
    "raQualificationRule" TEXT,
    "boqTitle" TEXT,
    "bidDetails" TEXT,
    "comprehensiveMaintenanceChargesRequired" TEXT,
    "typeOfBid" TEXT,
    "technicalClarificationTimeAllowed" TEXT,
    "inspectionRequired" TEXT,
    "estimatedBidValue" TEXT,
    "evaluationMethod" TEXT,
    "advisoryBank" TEXT,
    "ePbgPercentage" TEXT,
    "ePbgDurationMonths" TEXT,
    "msePurchasePreference" TEXT,
    "miiPurchasePreference" TEXT,
    "consigneesReportingOfficer" TEXT,
    "mediationClause" TEXT,
    "arbitrationClause" TEXT,
    "itemCategory" TEXT,
    "totalQuantity" TEXT,
    "bidStatus" TEXT,
    "differenceBetweenRank1" TEXT,
    "nameOfRank1" TEXT,
    "valueOfRank1" TEXT,
    "differenceBetweenRank2" TEXT,
    "nameOfRank2" TEXT,
    "valueOfRank2" TEXT,
    "evaluationTableData" TEXT,
    "parseStatus" TEXT,
    "parseError" TEXT,
    "resultAutomationStatus" TEXT,
    "resultAutomationError" TEXT,
    "fileId" INTEGER NOT NULL,
    "tenderStatusId" INTEGER,
    "utilityMappingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_merged_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tender_merged_referenceNo_key" ON "tender_merged"("referenceNo");

-- CreateIndex
CREATE INDEX "tender_merged_fileId_idx" ON "tender_merged"("fileId");

-- CreateIndex
CREATE INDEX "tender_merged_tenderStatusId_idx" ON "tender_merged"("tenderStatusId");

-- CreateIndex
CREATE INDEX "tender_merged_utilityMappingId_idx" ON "tender_merged"("utilityMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_merged_tenderType_originalId_key" ON "tender_merged"("tenderType", "originalId");

-- CreateIndex
CREATE INDEX "evaluations_tenderMergedId_idx" ON "evaluations"("tenderMergedId");

-- CreateIndex
CREATE INDEX "reportings_tenderMergedId_idx" ON "reportings"("tenderMergedId");

-- CreateIndex
CREATE INDEX "tender_associations_tenderMergedId_idx" ON "tender_associations"("tenderMergedId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_associations_tenderMergedId_associationId_key" ON "tender_associations"("tenderMergedId", "associationId");

-- CreateIndex
CREATE INDEX "tender_extra_fields_tenderMergedId_idx" ON "tender_extra_fields"("tenderMergedId");

-- AddForeignKey
ALTER TABLE "tender_extra_fields" ADD CONSTRAINT "tender_extra_fields_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportings" ADD CONSTRAINT "reportings_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_merged" ADD CONSTRAINT "tender_merged_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_merged" ADD CONSTRAINT "tender_merged_tenderStatusId_fkey" FOREIGN KEY ("tenderStatusId") REFERENCES "tender_status_table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_merged" ADD CONSTRAINT "tender_merged_utilityMappingId_fkey" FOREIGN KEY ("utilityMappingId") REFERENCES "utility_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
