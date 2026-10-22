-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "docketNumber" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "enquiryDate" TIMESTAMP(3) NOT NULL,
    "enquiryType" TEXT,
    "state" TEXT,
    "paymentTerms" TEXT,
    "inspection" TEXT,
    "pbg" TEXT,
    "utility" TEXT,
    "vaPercent" DOUBLE PRECISION,
    "orderStatus" TEXT,
    "attachmentName" TEXT,
    "attachmentUrl" TEXT,
    "attachmentType" TEXT,
    "attachmentSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryItem" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_docketNumber_key" ON "Enquiry"("docketNumber");

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
