-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FIRM', 'VARIABLE');

-- AlterTable
ALTER TABLE "tender_merged" ADD COLUMN     "price" "PriceType";
