-- CreateTable
CREATE TABLE "VerifyBom" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "rmItemCode" TEXT NOT NULL,
    "bomIdType" TEXT,
    "bomItemQty" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifyBom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerifyBom_bomId_itemCode_rmItemCode_key" ON "VerifyBom"("bomId", "itemCode", "rmItemCode");
