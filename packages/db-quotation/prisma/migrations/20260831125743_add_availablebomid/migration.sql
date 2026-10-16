-- AlterTable
ALTER TABLE "EnquiryItem" ADD COLUMN     "availableBomIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "VerifyBom_itemCode_idx" ON "VerifyBom"("itemCode");
