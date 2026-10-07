-- CreateTable
CREATE TABLE "column_indices" (
    "id" SERIAL NOT NULL,
    "columnName" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "displayName" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "width" INTEGER,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "column_indices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "column_indices_columnName_key" ON "column_indices"("columnName");
