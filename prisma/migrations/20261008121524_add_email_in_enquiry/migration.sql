-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "emailApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailSentBy" TEXT;
