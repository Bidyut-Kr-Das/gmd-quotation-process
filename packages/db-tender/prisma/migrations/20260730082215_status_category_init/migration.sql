-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('AOC', 'FINANCIAL', 'TECHNICAL');

-- AlterTable
ALTER TABLE "tender_merged" ADD COLUMN     "statusCategory" "StatusCategory";
