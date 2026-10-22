-- CreateTable
CREATE TABLE "BisStatus" (
    "id" TEXT NOT NULL,
    "itemName" TEXT,
    "bisNo" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "applicationStatus" TEXT,
    "remark" TEXT,
    "reachedLab" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BisStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BisStatus_bisNo_key" ON "BisStatus"("bisNo");
