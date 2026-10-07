-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "selectedContractNo" TEXT[] DEFAULT ARRAY[]::TEXT[];
