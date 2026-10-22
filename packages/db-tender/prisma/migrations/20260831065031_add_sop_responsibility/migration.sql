-- CreateTable
CREATE TABLE "sop_responsibilities" (
    "id" SERIAL NOT NULL,
    "columnName" TEXT NOT NULL,
    "description" TEXT,
    "allocatedTo" TEXT,
    "email" TEXT,
    "dailyLog" TEXT,
    "date" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_responsibilities_columnName_idx" ON "sop_responsibilities"("columnName");

-- CreateIndex
CREATE INDEX "sop_responsibilities_date_idx" ON "sop_responsibilities"("date");
