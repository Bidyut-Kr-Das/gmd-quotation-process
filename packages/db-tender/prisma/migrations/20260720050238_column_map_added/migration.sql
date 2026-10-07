-- CreateTable
CREATE TABLE "column_mappings" (
    "id" SERIAL NOT NULL,
    "excelHeader" TEXT NOT NULL,
    "dbField" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "column_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "column_mappings_dbField_idx" ON "column_mappings"("dbField");

-- CreateIndex
CREATE UNIQUE INDEX "column_mappings_excelHeader_dbField_key" ON "column_mappings"("excelHeader", "dbField");
