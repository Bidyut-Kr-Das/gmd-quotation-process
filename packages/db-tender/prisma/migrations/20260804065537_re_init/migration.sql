/*
  Warnings:

  - A unique constraint covering the columns `[gemTenderId,associationId]` on the table `tender_associations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[nonGemTenderId,associationId]` on the table `tender_associations` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "tender_associations" DROP CONSTRAINT "tender_associations_tenderMergedId_fkey";

-- AlterTable
ALTER TABLE "tender_associations" ADD COLUMN     "gemTenderId" INTEGER,
ADD COLUMN     "nonGemTenderId" INTEGER;

-- CreateIndex
CREATE INDEX "tender_associations_gemTenderId_idx" ON "tender_associations"("gemTenderId");

-- CreateIndex
CREATE INDEX "tender_associations_nonGemTenderId_idx" ON "tender_associations"("nonGemTenderId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_associations_gemTenderId_associationId_key" ON "tender_associations"("gemTenderId", "associationId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_associations_nonGemTenderId_associationId_key" ON "tender_associations"("nonGemTenderId", "associationId");

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_gemTenderId_fkey" FOREIGN KEY ("gemTenderId") REFERENCES "gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_nonGemTenderId_fkey" FOREIGN KEY ("nonGemTenderId") REFERENCES "non_gem_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;
