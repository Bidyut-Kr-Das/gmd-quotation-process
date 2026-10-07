-- CreateTable
CREATE TABLE "emd_details_cash" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "CUSTOMER NAME" TEXT,
    "ISSUE DT" TIMESTAMP(3),
    "EMD AMT" DOUBLE PRECISION,
    "PERMANENT (Y/N)" TEXT,
    "TENDER NO" TEXT,
    "CH/DD NO" TEXT,
    "A/C HOLDER" TEXT,
    "STATUS AS PER SUJIB DA & OTHER" TEXT,
    "CAN BE REFUNDED(Y/N)" TEXT,
    "TM NO." TEXT,
    "RANK" TEXT,
    "PO ISSUE STATUS" TEXT,
    "AOC-Award of Contract Status" TEXT,
    "REFUNDABLE/ NOT" TEXT,
    "STATUS REFUNDED/PENDING" TEXT,
    "EXPECTED REFUND DATE/ REFUNDED DATE" TIMESTAMP(3),
    "status of tender" TEXT,
    "conditions for refund" TEXT,
    "remarks" TEXT,

    CONSTRAINT "emd_details_cash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emd_details_cash_TENDER NO_idx" ON "emd_details_cash"("TENDER NO");

-- CreateIndex
CREATE INDEX "emd_details_cash_TM NO._idx" ON "emd_details_cash"("TM NO.");

-- CreateIndex
CREATE INDEX "emd_details_cash_CUSTOMER NAME_idx" ON "emd_details_cash"("CUSTOMER NAME");
