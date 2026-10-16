/*
  Warnings:

  - You are about to drop the column `apm` on the `EnquiryItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "apm" TEXT;

-- AlterTable
ALTER TABLE "EnquiryItem" DROP COLUMN "apm";
