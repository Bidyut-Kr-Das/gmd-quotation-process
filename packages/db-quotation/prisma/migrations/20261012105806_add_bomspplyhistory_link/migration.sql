-- AlterTable
ALTER TABLE "SupplyHistoryItem" ADD COLUMN     "selectedBomItemId" TEXT;

-- CreateTable
CREATE TABLE "SupplyHistoryBomLink" (
    "id" TEXT NOT NULL,
    "supplyHistoryItemId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomItemId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyHistoryBomLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyHistoryBomLink_supplyHistoryItemId_idx" ON "SupplyHistoryBomLink"("supplyHistoryItemId");

-- CreateIndex
CREATE INDEX "SupplyHistoryBomLink_bomId_idx" ON "SupplyHistoryBomLink"("bomId");

-- CreateIndex
CREATE INDEX "SupplyHistoryBomLink_bomItemId_idx" ON "SupplyHistoryBomLink"("bomItemId");

-- CreateIndex
CREATE INDEX "SupplyHistoryBomLink_rawMaterialId_idx" ON "SupplyHistoryBomLink"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyHistoryBomLink_supplyHistoryItemId_bomItemId_key" ON "SupplyHistoryBomLink"("supplyHistoryItemId", "bomItemId");

-- CreateIndex
CREATE INDEX "SupplyHistoryItem_selectedBomItemId_idx" ON "SupplyHistoryItem"("selectedBomItemId");

-- CreateIndex
CREATE INDEX "SupplyHistoryItem_erpItemCode_idx" ON "SupplyHistoryItem"("erpItemCode");

-- AddForeignKey
ALTER TABLE "SupplyHistoryItem" ADD CONSTRAINT "SupplyHistoryItem_selectedBomItemId_fkey" FOREIGN KEY ("selectedBomItemId") REFERENCES "BomItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyHistoryBomLink" ADD CONSTRAINT "SupplyHistoryBomLink_supplyHistoryItemId_fkey" FOREIGN KEY ("supplyHistoryItemId") REFERENCES "SupplyHistoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyHistoryBomLink" ADD CONSTRAINT "SupplyHistoryBomLink_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyHistoryBomLink" ADD CONSTRAINT "SupplyHistoryBomLink_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "BomItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyHistoryBomLink" ADD CONSTRAINT "SupplyHistoryBomLink_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
