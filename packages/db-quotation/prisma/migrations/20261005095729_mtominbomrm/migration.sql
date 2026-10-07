/*
  Warnings:

  - You are about to drop the column `bomId` on the `RawMaterial` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "RawMaterial" DROP CONSTRAINT "RawMaterial_bomId_fkey";

-- AlterTable
ALTER TABLE "RawMaterial" DROP COLUMN "bomId";

-- CreateTable
CREATE TABLE "_BomToRawMaterial" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BomToRawMaterial_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BomToRawMaterial_B_index" ON "_BomToRawMaterial"("B");

-- AddForeignKey
ALTER TABLE "_BomToRawMaterial" ADD CONSTRAINT "_BomToRawMaterial_A_fkey" FOREIGN KEY ("A") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BomToRawMaterial" ADD CONSTRAINT "_BomToRawMaterial_B_fkey" FOREIGN KEY ("B") REFERENCES "RawMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
