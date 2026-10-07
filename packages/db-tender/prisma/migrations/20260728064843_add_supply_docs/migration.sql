-- CreateTable
CREATE TABLE "supply_docs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "saleBillNumber" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "lastModified" TIMESTAMP(3),

    CONSTRAINT "supply_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supply_docs_saleBillNumber_idx" ON "supply_docs"("saleBillNumber");
