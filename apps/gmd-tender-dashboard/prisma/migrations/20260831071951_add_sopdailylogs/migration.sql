-- CreateTable
CREATE TABLE "sop_daily_logs" (
    "id" SERIAL NOT NULL,
    "sopResponsibilityId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_daily_logs_date_idx" ON "sop_daily_logs"("date");

-- CreateIndex
CREATE INDEX "sop_daily_logs_sopResponsibilityId_idx" ON "sop_daily_logs"("sopResponsibilityId");

-- CreateIndex
CREATE UNIQUE INDEX "sop_daily_logs_sopResponsibilityId_date_key" ON "sop_daily_logs"("sopResponsibilityId", "date");

-- AddForeignKey
ALTER TABLE "sop_daily_logs" ADD CONSTRAINT "sop_daily_logs_sopResponsibilityId_fkey" FOREIGN KEY ("sopResponsibilityId") REFERENCES "sop_responsibilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
