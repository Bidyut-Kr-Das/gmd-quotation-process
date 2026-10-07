-- CreateTable
CREATE TABLE "InspectionCost" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "costPct" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionCost_type_key" ON "InspectionCost"("type");
