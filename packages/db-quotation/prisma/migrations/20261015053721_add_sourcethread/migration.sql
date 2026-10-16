/*
  Warnings:

  - A unique constraint covering the columns `[sourceThreadId]` on the table `Enquiry` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "sourceThreadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_sourceThreadId_key" ON "Enquiry"("sourceThreadId");
