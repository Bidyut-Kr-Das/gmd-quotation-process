/*
  Warnings:

  - Made the column `is_gmd_client` on table `docket_quotation_threads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `is_replied` on table `docket_quotation_threads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `msg_count` on table `docket_quotation_threads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `docket_quotation_threads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `docket_quotation_threads` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ContractReview" ADD COLUMN     "rmPhysicalStock" TEXT;

-- AlterTable
ALTER TABLE "docket_quotation_threads" ALTER COLUMN "is_gmd_client" SET NOT NULL,
ALTER COLUMN "is_replied" SET NOT NULL,
ALTER COLUMN "msg_count" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;
