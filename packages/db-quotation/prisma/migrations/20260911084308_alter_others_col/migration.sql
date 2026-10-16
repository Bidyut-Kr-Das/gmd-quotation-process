/*
  Warnings:

  - The `others` column on the `EnquiryItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "EnquiryItem" DROP COLUMN "others",
ADD COLUMN     "others" TEXT[] DEFAULT ARRAY[]::TEXT[];
