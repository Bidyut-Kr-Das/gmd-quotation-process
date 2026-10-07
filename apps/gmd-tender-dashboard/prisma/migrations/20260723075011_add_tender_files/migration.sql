-- CreateTable
CREATE TABLE "tender_files" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tenderMergedId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_files_tenderMergedId_idx" ON "tender_files"("tenderMergedId");

-- AddForeignKey
ALTER TABLE "tender_files" ADD CONSTRAINT "tender_files_tenderMergedId_fkey" FOREIGN KEY ("tenderMergedId") REFERENCES "tender_merged"("id") ON DELETE CASCADE ON UPDATE CASCADE;
