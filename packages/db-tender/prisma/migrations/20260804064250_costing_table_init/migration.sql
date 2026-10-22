/*
  Warnings:

  - You are about to drop the column `gemTenderId` on the `tender_associations` table. All the data in the column will be lost.
  - You are about to drop the column `nonGemTenderId` on the `tender_associations` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "tender_associations" DROP CONSTRAINT "tender_associations_gemTenderId_fkey";

-- DropForeignKey
ALTER TABLE "tender_associations" DROP CONSTRAINT "tender_associations_nonGemTenderId_fkey";

-- DropForeignKey
ALTER TABLE "tender_associations" DROP CONSTRAINT "tender_associations_tenderMergedId_fkey";

-- DropIndex
DROP INDEX "tender_associations_gemTenderId_associationId_key";

-- DropIndex
DROP INDEX "tender_associations_gemTenderId_idx";

-- DropIndex
DROP INDEX "tender_associations_nonGemTenderId_associationId_key";

-- DropIndex
DROP INDEX "tender_associations_nonGemTenderId_idx";

-- AlterTable
ALTER TABLE "tender_associations" DROP COLUMN "gemTenderId",
DROP COLUMN "nonGemTenderId";

-- AlterTable
ALTER TABLE "tender_merged" ADD COLUMN     "baseDate" TIMESTAMP(3),
ADD COLUMN     "boqSummary" TEXT;

-- CreateTable
CREATE TABLE "CostingSheetDetails" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemSchedule" TEXT,
    "proposedErpItemName" TEXT,
    "proposedErpQuantity" TEXT,
    "priceOfFullQuantity" TEXT,
    "cva" TEXT,
    "tenderMergedId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostingSheetDetails_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheetDetails" ADD CONSTRAINT "CostingSheetDetails_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;
