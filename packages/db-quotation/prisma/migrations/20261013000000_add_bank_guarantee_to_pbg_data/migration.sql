-- Manually uploaded Bank Guarantee documents (array of { name, url, fileId }).
ALTER TABLE "pbg_data" ADD COLUMN "bank_guarantee" JSONB;
