-- AlterTable
ALTER TABLE "ContractReview" ADD COLUMN     "inspection" TEXT,
ADD COLUMN     "mcReceivedPending" TEXT,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "GMDUpdateItem" ADD COLUMN     "orderDelivery" TEXT;
