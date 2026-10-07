/*
  Warnings:

  - The `contractNo` column on the `Enquiry` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "contractNo",
ADD COLUMN     "contractNo" TEXT[] DEFAULT ARRAY[]::TEXT[];
