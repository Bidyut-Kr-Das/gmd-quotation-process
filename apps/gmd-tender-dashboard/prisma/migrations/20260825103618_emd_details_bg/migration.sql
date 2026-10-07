-- DropIndex
DROP INDEX "emd_details_cash_tenderNo_idx";

-- DropIndex
DROP INDEX "emd_details_cash_tmNo_idx";

-- CreateTable
CREATE TABLE "EmdDetailsBG" (
    "id" VARCHAR(100) NOT NULL,
    "trantype" TEXT,
    "bankName" TEXT,
    "partyCode" TEXT,
    "partyName" TEXT,
    "staffName" TEXT,
    "bgNo" TEXT,
    "bgDate" TEXT,
    "bgAmtLocal" TEXT,
    "bgAmtFc" TEXT,
    "expiryDate" TEXT,
    "claimDate" TEXT,
    "remark" TEXT,
    "status" TEXT,
    "remarks" TEXT,
    "contactNo" TEXT,
    "contactEmailId" TEXT,
    "address" TEXT,
    "tenderNo1" TEXT,
    "tenderNo" TEXT,
    "tenderNo2" TEXT,
    "match" TEXT,
    "bgMatch" TEXT,
    "statusPriceAssDone" TEXT,
    "tmNo" TEXT,
    "docketNo" TEXT,
    "lastEmailSent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmdDetailsBG_pkey" PRIMARY KEY ("id")
);
