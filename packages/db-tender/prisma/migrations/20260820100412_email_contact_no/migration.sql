-- AlterTable
ALTER TABLE "SupplyHistory" ADD COLUMN     "contactNo" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "itemSchedule" TEXT;

-- AlterTable
ALTER TABLE "tender_merged" ALTER COLUMN "currentStatus" SET DEFAULT 'NOT EVALUATED';
