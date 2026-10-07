-- CreateEnum
CREATE TYPE "TypeTestLab" AS ENUM ('CPRI', 'ERDA', 'NABL');

-- CreateTable
CREATE TABLE "type_tests" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "testCertificateNo" TEXT NOT NULL,
    "testCertificateUrl" TEXT,
    "lab" "TypeTestLab",
    "issuedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "validity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "type_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "type_tests_itemCode_idx" ON "type_tests"("itemCode");

-- CreateIndex
CREATE INDEX "type_tests_testCertificateNo_idx" ON "type_tests"("testCertificateNo");

-- CreateIndex
CREATE UNIQUE INDEX "type_tests_itemCode_testCertificateNo_key" ON "type_tests"("itemCode", "testCertificateNo");
