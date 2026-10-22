-- CreateTable
CREATE TABLE "IndentListing" (
    "id" TEXT NOT NULL,
    "itemName" TEXT,
    "size" TEXT,
    "pnRating" TEXT,
    "mcReceivedPending" TEXT,
    "totalBalBillAgCont" DOUBLE PRECISION,
    "v1" TEXT,
    "v2" TEXT,
    "v3" TEXT,
    "v4" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndentListing_itemName_size_pnRating_mcReceivedPending_key" ON "IndentListing"("itemName", "size", "pnRating", "mcReceivedPending");
