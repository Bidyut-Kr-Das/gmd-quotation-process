/*
  Warnings:

  - You are about to drop the column `bomItemQty` on the `Bom` table. All the data in the column will be lost.
  - You are about to drop the `_BomToFullItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_BomToRawMaterial` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `fullItemId` to the `Bom` table without a default value. This is not possible if the table is not empty.
  - Made the column `bomId` on table `Bom` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "_BomToFullItem" DROP CONSTRAINT "_BomToFullItem_A_fkey";

-- DropForeignKey
ALTER TABLE "_BomToFullItem" DROP CONSTRAINT "_BomToFullItem_B_fkey";

-- DropForeignKey
ALTER TABLE "_BomToRawMaterial" DROP CONSTRAINT "_BomToRawMaterial_A_fkey";

-- DropForeignKey
ALTER TABLE "_BomToRawMaterial" DROP CONSTRAINT "_BomToRawMaterial_B_fkey";

-- AlterTable
ALTER TABLE "Bom" DROP COLUMN "bomItemQty",
ADD COLUMN     "fullItemId" TEXT NOT NULL,
ALTER COLUMN "bomId" SET NOT NULL;

-- DropTable
DROP TABLE "_BomToFullItem";

-- DropTable
DROP TABLE "_BomToRawMaterial";

-- CreateTable
CREATE TABLE "BomItem" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "fullItemId" TEXT,
    "quantity" INTEGER,
    "cost" DECIMAL(65,30),
    "noUse" TEXT,
    "cBatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomItem_bomId_idx" ON "BomItem"("bomId");

-- CreateIndex
CREATE INDEX "BomItem_rawMaterialId_idx" ON "BomItem"("rawMaterialId");

-- CreateIndex
CREATE INDEX "BomItem_fullItemId_idx" ON "BomItem"("fullItemId");

-- CreateIndex
CREATE INDEX "Bom_fullItemId_idx" ON "Bom"("fullItemId");

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_fullItemId_fkey" FOREIGN KEY ("fullItemId") REFERENCES "FullItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_fullItemId_fkey" FOREIGN KEY ("fullItemId") REFERENCES "FullItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
