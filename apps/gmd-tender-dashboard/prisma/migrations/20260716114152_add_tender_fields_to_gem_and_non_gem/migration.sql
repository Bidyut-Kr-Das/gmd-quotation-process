-- AlterTable
ALTER TABLE "gem_tenders" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "docketNo" TEXT,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "non_gem_tenders" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "docketNo" TEXT,
ADD COLUMN     "remarks" TEXT;
