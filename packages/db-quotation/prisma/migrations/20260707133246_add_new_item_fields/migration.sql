-- AlterTable
ALTER TABLE "EnquiryItem" ADD COLUMN     "bypass" TEXT,
ADD COLUMN     "cost" DECIMAL(65,30),
ADD COLUMN     "costRefCode" TEXT,
ADD COLUMN     "discount" DECIMAL(65,30),
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "itemType" TEXT,
ADD COLUMN     "moc" TEXT,
ADD COLUMN     "operationType" TEXT,
ADD COLUMN     "pnRating" TEXT,
ADD COLUMN     "productCost" DECIMAL(65,30),
ADD COLUMN     "size" TEXT,
ADD COLUMN     "stockStatus" TEXT;
