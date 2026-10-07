-- CreateEnum
CREATE TYPE "decision" AS ENUM ('YES', 'NO', 'NOT_DECIDED');

-- CreateTable
CREATE TABLE "files" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "uploadedBy" TEXT,
    "status" TEXT,
    "totalCount" INTEGER DEFAULT 0,
    "excludedCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gem_tenders" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "tenderBrief" TEXT,
    "value" TEXT,
    "deadline" TIMESTAMP(3),
    "location" TEXT,
    "organization" TEXT,
    "documentFees" TEXT,
    "emd" TEXT,
    "msmeExemption" TEXT,
    "startupExemption" TEXT,
    "quantity" TEXT,
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
    "parse_status" TEXT,
    "parse_error" TEXT,
    "itemCategory" TEXT,
    "totalQuantity" TEXT,
    "bidStatus" TEXT,
    "differenceBetweenRank1" TEXT,
    "app" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "aps" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "apm" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "tenderStatusId" INTEGER,
    "state" TEXT,
    "website" TEXT,
    "locationCount" INTEGER,
    "utilityMappingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gem_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_gem_tenders" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "tenderBrief" TEXT,
    "estimatedBidValue" TEXT,
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
    "app" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "aps" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "apm" "decision" NOT NULL DEFAULT 'NOT_DECIDED',
    "tenderStatusId" INTEGER,
    "state" TEXT,
    "website" TEXT,
    "locationCount" INTEGER,
    "utilityMappingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_gem_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_extra_fields" (
    "id" SERIAL NOT NULL,
    "gemTenderId" INTEGER,
    "nonGemTenderId" INTEGER,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_extra_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExlusionKeywords" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT DEFAULT 'cable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExlusionKeywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "associations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_associations" (
    "id" SERIAL NOT NULL,
    "gemTenderId" INTEGER,
    "nonGemTenderId" INTEGER,
    "associationId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportings" (
    "id" SERIAL NOT NULL,
    "gemTenderId" INTEGER NOT NULL,
    "officer" TEXT NOT NULL,
    "address" TEXT,
    "quantity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reportings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_status_table" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT,
    "website" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GEM',
    "userId" TEXT,
    "password" TEXT,
    "mobileNo" TEXT,
    "profilePassword" TEXT,
    "dscName" TEXT,
    "dscPassword" TEXT,

    CONSTRAINT "tender_status_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" SERIAL NOT NULL,
    "gemTenderId" INTEGER NOT NULL,
    "sellerName" TEXT NOT NULL,
    "offeredItem" TEXT,
    "totalPrice" TEXT,
    "rank" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "tenderId" INTEGER NOT NULL,
    "tenderType" TEXT NOT NULL,
    "briefText" TEXT NOT NULL,
    "originalAi" TEXT NOT NULL,
    "correctedAi" TEXT NOT NULL,
    "feedbackReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_mappings" (
    "id" SERIAL NOT NULL,
    "organization" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utility_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gem_tenders_referenceNo_key" ON "gem_tenders"("referenceNo");

-- CreateIndex
CREATE INDEX "gem_tenders_fileId_idx" ON "gem_tenders"("fileId");

-- CreateIndex
CREATE INDEX "gem_tenders_utilityMappingId_idx" ON "gem_tenders"("utilityMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "non_gem_tenders_referenceNo_key" ON "non_gem_tenders"("referenceNo");

-- CreateIndex
CREATE INDEX "non_gem_tenders_fileId_idx" ON "non_gem_tenders"("fileId");

-- CreateIndex
CREATE INDEX "non_gem_tenders_utilityMappingId_idx" ON "non_gem_tenders"("utilityMappingId");

-- CreateIndex
CREATE INDEX "tender_extra_fields_gemTenderId_idx" ON "tender_extra_fields"("gemTenderId");

-- CreateIndex
CREATE INDEX "tender_extra_fields_nonGemTenderId_idx" ON "tender_extra_fields"("nonGemTenderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExlusionKeywords_category_key" ON "ExlusionKeywords"("category");

-- CreateIndex
CREATE INDEX "tender_associations_gemTenderId_idx" ON "tender_associations"("gemTenderId");

-- CreateIndex
CREATE INDEX "tender_associations_nonGemTenderId_idx" ON "tender_associations"("nonGemTenderId");

-- CreateIndex
CREATE INDEX "tender_associations_associationId_idx" ON "tender_associations"("associationId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_associations_gemTenderId_associationId_key" ON "tender_associations"("gemTenderId", "associationId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_associations_nonGemTenderId_associationId_key" ON "tender_associations"("nonGemTenderId", "associationId");

-- CreateIndex
CREATE INDEX "reportings_gemTenderId_idx" ON "reportings"("gemTenderId");

-- CreateIndex
CREATE INDEX "evaluations_gemTenderId_idx" ON "evaluations"("gemTenderId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feedback_tenderId_tenderType_key" ON "ai_feedback"("tenderId", "tenderType");

-- AddForeignKey
ALTER TABLE "gem_tenders" ADD CONSTRAINT "gem_tenders_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gem_tenders" ADD CONSTRAINT "gem_tenders_tenderStatusId_fkey" FOREIGN KEY ("tenderStatusId") REFERENCES "tender_status_table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gem_tenders" ADD CONSTRAINT "gem_tenders_utilityMappingId_fkey" FOREIGN KEY ("utilityMappingId") REFERENCES "utility_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_gem_tenders" ADD CONSTRAINT "non_gem_tenders_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_gem_tenders" ADD CONSTRAINT "non_gem_tenders_tenderStatusId_fkey" FOREIGN KEY ("tenderStatusId") REFERENCES "tender_status_table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_gem_tenders" ADD CONSTRAINT "non_gem_tenders_utilityMappingId_fkey" FOREIGN KEY ("utilityMappingId") REFERENCES "utility_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_extra_fields" ADD CONSTRAINT "tender_extra_fields_gemTenderId_fkey" FOREIGN KEY ("gemTenderId") REFERENCES "gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_extra_fields" ADD CONSTRAINT "tender_extra_fields_nonGemTenderId_fkey" FOREIGN KEY ("nonGemTenderId") REFERENCES "non_gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_gemTenderId_fkey" FOREIGN KEY ("gemTenderId") REFERENCES "gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_nonGemTenderId_fkey" FOREIGN KEY ("nonGemTenderId") REFERENCES "non_gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportings" ADD CONSTRAINT "reportings_gemTenderId_fkey" FOREIGN KEY ("gemTenderId") REFERENCES "gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_gemTenderId_fkey" FOREIGN KEY ("gemTenderId") REFERENCES "gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
