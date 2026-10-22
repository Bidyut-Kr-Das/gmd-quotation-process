-- AlterTable
ALTER TABLE "EnquiryItem" ADD COLUMN     "erpItemCode" TEXT;

-- CreateTable
CREATE TABLE "GmdItemCode" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "moc" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pnGmd" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmdItemCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmdItemCode_itemType_moc_operation_size_pnGmd_key" ON "GmdItemCode"("itemType", "moc", "operation", "size", "pnGmd");
