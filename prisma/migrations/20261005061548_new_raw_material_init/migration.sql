-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" TEXT NOT NULL,
    "erpItemCode" TEXT,
    "itemNameAuto" TEXT,
    "itemNameDerived" TEXT,
    "l1" TEXT,
    "l2ValveType" TEXT,
    "l3Dia" TEXT,
    "l7Dimension" TEXT,
    "l4Component" TEXT,
    "l5Material" TEXT,
    "l6Std" TEXT,
    "l8ItemCategory" TEXT,
    "um" TEXT,
    "conv1" TEXT,
    "pcsWgt" TEXT,
    "aum" TEXT,
    "availableStock" TEXT,
    "cost" TEXT,
    "usdRateOption" TEXT,
    "hsnCode" TEXT,
    "hsnCodeValidation" TEXT,
    "conv2" TEXT,
    "majorMarking" TEXT,
    "newItemStatus" TEXT,
    "currentStatus" TEXT,
    "rmType" TEXT,
    "indianImported" TEXT,
    "bomId" TEXT,
    "transferred" BOOLEAN NOT NULL DEFAULT false,
    "vendorReference" TEXT,
    "attachmentUrl" TEXT,
    "orderDelivery" TEXT,
    "cBatch" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_erpItemCode_key" ON "RawMaterial"("erpItemCode");
