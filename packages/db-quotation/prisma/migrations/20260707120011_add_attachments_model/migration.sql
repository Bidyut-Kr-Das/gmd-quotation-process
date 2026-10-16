/*
  Warnings:

  - You are about to drop the column `attachmentName` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentSize` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentType` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentUrl` on the `Enquiry` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "attachmentName",
DROP COLUMN "attachmentSize",
DROP COLUMN "attachmentType",
DROP COLUMN "attachmentUrl";

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
