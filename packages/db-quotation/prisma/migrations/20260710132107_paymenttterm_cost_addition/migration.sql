-- CreateTable
CREATE TABLE "PaymentTermsCost" (
    "id" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "costPct" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTermsCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTermsCost_terms_key" ON "PaymentTermsCost"("terms");
