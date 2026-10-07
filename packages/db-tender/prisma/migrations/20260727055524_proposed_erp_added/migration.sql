/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `associations` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "tender_associations" DROP CONSTRAINT "tender_associations_associationId_fkey";

-- AlterTable
ALTER TABLE "tender_merged" ADD COLUMN     "proposedErpItemName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "associations_email_key" ON "associations"("email");

-- AddForeignKey
ALTER TABLE "tender_associations" ADD CONSTRAINT "tender_associations_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
