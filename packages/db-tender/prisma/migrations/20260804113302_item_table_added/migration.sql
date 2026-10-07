-- CreateTable
CREATE TABLE "Items" (
    "id" SERIAL NOT NULL,
    "itemcode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemSchedule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Items_itemcode_key" ON "Items"("itemcode");
