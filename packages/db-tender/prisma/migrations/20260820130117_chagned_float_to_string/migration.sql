/*
  Warnings:

  - You are about to drop the column `A/C HOLDER` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `AOC-Award of Contract Status` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `CAN BE REFUNDED(Y/N)` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `CH/DD NO` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `CUSTOMER NAME` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `EMD AMT` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `EXPECTED REFUND DATE/ REFUNDED DATE` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `ISSUE DT` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `PERMANENT (Y/N)` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `PO ISSUE STATUS` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `RANK` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `REFUNDABLE/ NOT` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `STATUS AS PER SUJIB DA & OTHER` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `STATUS REFUNDED/PENDING` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `TENDER NO` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `TM NO.` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `conditions for refund` on the `emd_details_cash` table. All the data in the column will be lost.
  - You are about to drop the column `status of tender` on the `emd_details_cash` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "emd_details_cash_CUSTOMER NAME_idx";

-- DropIndex
DROP INDEX "emd_details_cash_TENDER NO_idx";

-- DropIndex
DROP INDEX "emd_details_cash_TM NO._idx";

-- AlterTable
ALTER TABLE "emd_details_cash" DROP COLUMN "A/C HOLDER",
DROP COLUMN "AOC-Award of Contract Status",
DROP COLUMN "CAN BE REFUNDED(Y/N)",
DROP COLUMN "CH/DD NO",
DROP COLUMN "CUSTOMER NAME",
DROP COLUMN "EMD AMT",
DROP COLUMN "EXPECTED REFUND DATE/ REFUNDED DATE",
DROP COLUMN "ISSUE DT",
DROP COLUMN "PERMANENT (Y/N)",
DROP COLUMN "PO ISSUE STATUS",
DROP COLUMN "RANK",
DROP COLUMN "REFUNDABLE/ NOT",
DROP COLUMN "STATUS AS PER SUJIB DA & OTHER",
DROP COLUMN "STATUS REFUNDED/PENDING",
DROP COLUMN "TENDER NO",
DROP COLUMN "TM NO.",
DROP COLUMN "conditions for refund",
DROP COLUMN "status of tender",
ADD COLUMN     "acHolder" TEXT,
ADD COLUMN     "aocAwardOfContractStatus" TEXT,
ADD COLUMN     "canBeRefunded" TEXT,
ADD COLUMN     "chDdNo" TEXT,
ADD COLUMN     "conditionsForRefund" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "emdAmt" TEXT,
ADD COLUMN     "expectedRefundDateOrRefundedDate" TIMESTAMP(3),
ADD COLUMN     "issueDt" TIMESTAMP(3),
ADD COLUMN     "permanent" TEXT,
ADD COLUMN     "poIssueStatus" TEXT,
ADD COLUMN     "rank" TEXT,
ADD COLUMN     "refundableOrNot" TEXT,
ADD COLUMN     "statusAsPerSujibDaAndOther" TEXT,
ADD COLUMN     "statusOfTender" TEXT,
ADD COLUMN     "statusRefundedPending" TEXT,
ADD COLUMN     "tenderNo" TEXT,
ADD COLUMN     "tmNo" TEXT;

-- CreateIndex
CREATE INDEX "emd_details_cash_tenderNo_idx" ON "emd_details_cash"("tenderNo");

-- CreateIndex
CREATE INDEX "emd_details_cash_tmNo_idx" ON "emd_details_cash"("tmNo");

-- CreateIndex
CREATE INDEX "emd_details_cash_customerName_idx" ON "emd_details_cash"("customerName");
