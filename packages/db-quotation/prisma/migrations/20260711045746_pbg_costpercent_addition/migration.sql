-- CreateTable
CREATE TABLE "PbgCost" (
    "id" TEXT NOT NULL,
    "pbg" TEXT NOT NULL,
    "costPct" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PbgCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PbgCost_pbg_key" ON "PbgCost"("pbg");
