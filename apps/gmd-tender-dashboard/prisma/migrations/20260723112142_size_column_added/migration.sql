-- DropIndex
DROP INDEX "tender_merged_tenderType_originalId_key";

-- AlterTable
ALTER TABLE "gem_tenders" ADD COLUMN     "size" TEXT;

-- AlterTable
ALTER TABLE "tender_merged" ALTER COLUMN "originalId" DROP NOT NULL;
