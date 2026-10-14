-- User-set contract validity duration (e.g. "5y", "18m") for a PBG row.
ALTER TABLE "pbg_data" ADD COLUMN "validity_on" TEXT;
