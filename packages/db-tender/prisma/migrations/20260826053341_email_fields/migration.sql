-- AlterTable
ALTER TABLE "EmdDetailsBG" ADD COLUMN     "emailDraft" TEXT,
ADD COLUMN     "lastEmailSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "emd_details_cash" ADD COLUMN     "emailDraft" TEXT,
ADD COLUMN     "lastEmailSentAt" TIMESTAMP(3);
