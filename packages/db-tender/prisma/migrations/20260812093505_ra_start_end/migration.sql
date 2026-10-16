/*
  Warnings:

  - You are about to drop the column `reverseAuctionDate` on the `tender_merged` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tender_merged" DROP COLUMN "reverseAuctionDate",
ADD COLUMN     "reverseAuctionEndDate" TIMESTAMP(3),
ADD COLUMN     "reverseAuctionStartDate" TIMESTAMP(3);
