/*
  Warnings:

  - The `emdType` column on the `emd_merged` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "EmdType" AS ENUM ('CASH', 'BG');

-- AlterTable
ALTER TABLE "emd_merged" DROP COLUMN "emdType",
ADD COLUMN     "emdType" "EmdType";

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "websites" TEXT,
    "states" TEXT,
    "userId" TEXT,
    "password" TEXT,
    "mobileNo" TEXT,
    "profilePassword" TEXT,
    "dscName" TEXT,
    "dscPassword" TEXT,
    "otherRef" TEXT,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credentials_category_idx" ON "credentials"("category");

-- CreateIndex
CREATE INDEX "emd_merged_emdType_idx" ON "emd_merged"("emdType");
