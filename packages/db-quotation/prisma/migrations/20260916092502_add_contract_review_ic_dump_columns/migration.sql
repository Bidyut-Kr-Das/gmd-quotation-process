-- AlterTable
ALTER TABLE "ContractReview" ADD COLUMN     "diDate" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "inspectionNumber" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "offerNumber" TEXT[] DEFAULT ARRAY[]::TEXT[];
