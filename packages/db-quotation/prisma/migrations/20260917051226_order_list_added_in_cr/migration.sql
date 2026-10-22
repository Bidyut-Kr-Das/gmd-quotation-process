-- AlterTable
ALTER TABLE "ContractReview" ADD COLUMN     "orderList" TEXT[] DEFAULT ARRAY[]::TEXT[];
