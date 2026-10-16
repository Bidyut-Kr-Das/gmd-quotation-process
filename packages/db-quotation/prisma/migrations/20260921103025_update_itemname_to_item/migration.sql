/*
  Warnings:

  - You are about to drop the column `itemName` on the `IndentListing` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[item,size,pnRating,mcReceivedPending]` on the table `IndentListing` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "IndentListing_itemName_size_pnRating_mcReceivedPending_key";

-- AlterTable
ALTER TABLE "IndentListing" DROP COLUMN "itemName",
ADD COLUMN     "item" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "IndentListing_item_size_pnRating_mcReceivedPending_key" ON "IndentListing"("item", "size", "pnRating", "mcReceivedPending");
