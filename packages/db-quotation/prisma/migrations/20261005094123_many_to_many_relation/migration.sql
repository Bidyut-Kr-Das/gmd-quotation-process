/*
  Warnings:

  - The `cost` column on the `RawMaterial` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "RawMaterial" DROP COLUMN "cost",
ADD COLUMN     "cost" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "FullItem" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT,
    "itemName" TEXT,
    "itemScheduleName" TEXT,
    "itemType" TEXT,
    "moc" TEXT,
    "operation" TEXT,
    "size" TEXT,
    "no" TEXT,
    "pnGmd" TEXT,
    "cost" DECIMAL(65,30),
    "currentReqt" TEXT,
    "merged" TEXT,
    "duplicateMergerCount" TEXT,
    "bomNature" TEXT,
    "consumption1" TEXT,
    "consumption2" TEXT,
    "consumption3" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FullItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bom" (
    "id" TEXT NOT NULL,
    "bomId" TEXT,
    "bomIdType" TEXT,
    "bomItemQty" INTEGER,
    "bomCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BomToFullItem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BomToFullItem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "FullItem_itemCode_key" ON "FullItem"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Bom_bomId_key" ON "Bom"("bomId");

-- CreateIndex
CREATE INDEX "_BomToFullItem_B_index" ON "_BomToFullItem"("B");

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BomToFullItem" ADD CONSTRAINT "_BomToFullItem_A_fkey" FOREIGN KEY ("A") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BomToFullItem" ADD CONSTRAINT "_BomToFullItem_B_fkey" FOREIGN KEY ("B") REFERENCES "FullItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
