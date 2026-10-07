/*
  Warnings:

  - You are about to drop the column `option2` on the `Bom` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Bom" DROP COLUMN "option2";

-- AlterTable
ALTER TABLE "emd_details_cash" ADD COLUMN     "certificateByParty" TEXT,
ADD COLUMN     "certificateByUtility" TEXT;
