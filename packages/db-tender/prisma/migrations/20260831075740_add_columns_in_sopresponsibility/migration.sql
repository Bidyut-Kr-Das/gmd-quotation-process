-- AlterTable
ALTER TABLE "sop_responsibilities" ADD COLUMN     "dailyLogEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dateEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "doneFromWhere" TEXT,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE INDEX "sop_responsibilities_source_idx" ON "sop_responsibilities"("source");
