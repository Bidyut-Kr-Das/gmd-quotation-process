-- CreateEnum
CREATE TYPE "TenderUpdateStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NextAction" AS ENUM ('UPDATE_FROM_AB_LETTER', 'BG_REFUND_LETTER_TO_BE_SENT', 'FOLLOW_UP_FOR_FINANCIAL_STATUS', 'REVERSE_AUCTION_PENDING');

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slNo" INTEGER NOT NULL,
    "docketNo" TEXT NOT NULL,
    "tenderFor" TEXT NOT NULL,
    "typeOfTender" TEXT NOT NULL,
    "Tender No / NIT No with Date" TEXT NOT NULL,
    "Name of Work / Item Description" TEXT,
    "Total Quantity in Meter" DOUBLE PRECISION,
    "Name of the Client" TEXT NOT NULL,
    "Last Date of Submission" TIMESTAMP(3),
    "Tender Opening Date" TIMESTAMP(3),
    "Cost of Tender / Tender Fee (In Rs)" DOUBLE PRECISION,
    "EMD Amount (In Rs)" DOUBLE PRECISION,
    "Estimated Cost (In Rs)" DOUBLE PRECISION,
    "Bid Validity (in Days)" INTEGER,
    "Contract Period in Days" INTEGER,
    "Management Decision" TEXT NOT NULL,
    "Participated" BOOLEAN NOT NULL,
    "Tender Prepare By" TEXT NOT NULL,
    "Current Status" TEXT NOT NULL,
    "Tender Submitted Date" TIMESTAMP(3),
    "Reverse Auction Applicable" BOOLEAN,
    "Reverse Auction Date" TIMESTAMP(3),
    "EMD Payment Through BG / NEFT" TEXT,
    "BG No / UTR No" TEXT,
    "EMD Validity" TIMESTAMP(3),
    "LOI / PO No & Date" TEXT,
    "Remarks" TEXT,
    "Bid Validity Expired" BOOLEAN NOT NULL,
    "Diff % from L1" DOUBLE PRECISION,
    "Diff % from L2" DOUBLE PRECISION,
    "Reason" TEXT,
    "Final Remarks" TEXT,
    "attachmentUrl" TEXT,
    "tenderUpdateStatus" "TenderUpdateStatus" NOT NULL DEFAULT 'OPEN',
    "nextAction" "NextAction",
    "diffL1ManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "diffL2ManuallyEdited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartsheetTender" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enquiryDate" TEXT,
    "partyName" TEXT,
    "docketNumber" TEXT,
    "utility" TEXT,
    "quotationNumber" TEXT,
    "quotationDate" TEXT,
    "accountHolder" TEXT,
    "tenderPurchase" TEXT,
    "attachmentUrl" TEXT,
    "proposedErpItemName" TEXT,
    "proposedQty" TEXT,
    "priceBasis" TEXT,
    "aluminiumPrice" DOUBLE PRECISION,
    "aluminiumAlloyPrice" DOUBLE PRECISION,
    "copperTapePrice" DOUBLE PRECISION,
    "extrudedSemiconductivePrice" DOUBLE PRECISION,
    "htXlpePrice" DOUBLE PRECISION,
    "pvcTypeSt2Price" DOUBLE PRECISION,
    "galvanisedSteelFlatStripPrice" DOUBLE PRECISION,
    "fillerPrice" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartsheetTender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fy" TEXT,
    "saleBillNumber" TEXT,
    "saleBillDate" TEXT,
    "partyName" TEXT,
    "itemCode" TEXT,
    "itemName" TEXT,
    "lrNo" TEXT,
    "truckNo" TEXT,
    "partyRefNo" TEXT,
    "partyRefDate" TEXT,
    "contractVrNo" TEXT,
    "rate" DOUBLE PRECISION,
    "invoiceQty" DOUBLE PRECISION,
    "invoiceAmt" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tender_Tender No / NIT No with Date_key" ON "Tender"("Tender No / NIT No with Date");

-- CreateIndex
CREATE UNIQUE INDEX "SmartsheetTender_docketNumber_key" ON "SmartsheetTender"("docketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyHistory_saleBillNumber_itemCode_key" ON "SupplyHistory"("saleBillNumber", "itemCode");
