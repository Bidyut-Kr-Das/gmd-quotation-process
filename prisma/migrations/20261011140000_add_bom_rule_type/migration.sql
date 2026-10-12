-- BOM type a rule gives to the BOMs it creates (copied to "Bom"."bomIdType").
ALTER TABLE "BomRule" ADD COLUMN "bomIdType" TEXT;
