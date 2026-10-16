-- CreateTable
CREATE TABLE "Railways" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "financialYear" TEXT,
    "railway" TEXT,
    "tenderNo" TEXT,
    "erpTenderNo" TEXT,
    "qtnNo" TEXT,
    "dueDate" TIMESTAMP(3),
    "erpItemSchedule" TEXT,
    "erpCode" TEXT,
    "item" TEXT,
    "qtyInKms" DOUBLE PRECISION,
    "participated" TEXT,
    "reverseAuction" TEXT,
    "bidOpened" TEXT,
    "reverseAuctionDone" TEXT,
    "comparativeAvailable" TEXT,
    "raAnnounced" TEXT,
    "raAnnouncedOnDate" TIMESTAMP(3),
    "expectedContractStatus" TEXT,

    CONSTRAINT "Railways_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Railways_tenderNo_idx" ON "Railways"("tenderNo");
