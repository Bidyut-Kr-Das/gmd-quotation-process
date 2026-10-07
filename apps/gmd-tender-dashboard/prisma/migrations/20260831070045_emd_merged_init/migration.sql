-- CreateTable
CREATE TABLE "emd_merged" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emdType" TEXT,
    "tenderNo" TEXT,
    "tmNo" TEXT,
    "remarks" TEXT,
    "contactEmailId" TEXT,
    "emailDraft" TEXT,
    "lastEmailSent" TEXT,
    "lastEmailSentAt" TIMESTAMP(3),
    "reason" TEXT,
    "contactNo" TEXT,
    "address" TEXT,
    "docketNo" TEXT,
    "bgNo" TEXT,
    "customerName" TEXT,
    "emdAmt" TEXT,
    "bgAmtLocal" TEXT,
    "bgAmtFc" TEXT,
    "issueDt" TIMESTAMP(3),
    "bgDate" TEXT,
    "expectedRefundDateOrRefundedDate" TIMESTAMP(3),
    "expiryDate" TEXT,
    "claimDate" TEXT,
    "trantype" TEXT,
    "bankName" TEXT,
    "partyCode" TEXT,
    "staffName" TEXT,
    "status" TEXT,
    "match" TEXT,
    "bgMatch" TEXT,
    "statusPriceAssDone" TEXT,
    "permanent" TEXT,
    "chDdNo" TEXT,
    "acHolder" TEXT,
    "statusAsPerSujibDaAndOther" TEXT,
    "canBeRefunded" TEXT,
    "rank" TEXT,
    "poIssueStatus" TEXT,
    "aocAwardOfContractStatus" TEXT,
    "refundableOrNot" TEXT,
    "statusRefundedPending" TEXT,
    "statusOfTender" TEXT,
    "conditionsForRefund" TEXT,
    "certificateByParty" TEXT,
    "certificateByUtility" TEXT,

    CONSTRAINT "emd_merged_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EmdMergedToTenderMerged" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_EmdMergedToTenderMerged_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "emd_merged_docketNo_idx" ON "emd_merged"("docketNo");

-- CreateIndex
CREATE INDEX "emd_merged_tenderNo_idx" ON "emd_merged"("tenderNo");

-- CreateIndex
CREATE INDEX "emd_merged_tmNo_idx" ON "emd_merged"("tmNo");

-- CreateIndex
CREATE INDEX "emd_merged_customerName_idx" ON "emd_merged"("customerName");

-- CreateIndex
CREATE INDEX "emd_merged_emdType_idx" ON "emd_merged"("emdType");

-- CreateIndex
CREATE INDEX "emd_merged_bgNo_idx" ON "emd_merged"("bgNo");

-- CreateIndex
CREATE INDEX "_EmdMergedToTenderMerged_B_index" ON "_EmdMergedToTenderMerged"("B");

-- AddForeignKey
ALTER TABLE "_EmdMergedToTenderMerged" ADD CONSTRAINT "_EmdMergedToTenderMerged_A_fkey" FOREIGN KEY ("A") REFERENCES "emd_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EmdMergedToTenderMerged" ADD CONSTRAINT "_EmdMergedToTenderMerged_B_fkey" FOREIGN KEY ("B") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;
