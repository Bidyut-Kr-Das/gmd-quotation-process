-- Bring ContractReview in line with the quotation app model.
ALTER TABLE "ContractReview" ADD COLUMN "costCodeRef" TEXT,
ADD COLUMN "rmPhysicalStock" TEXT,
ADD COLUMN "cBatch" TEXT,
ADD COLUMN "nBatch" TEXT;

-- Diagram verdict now uses the quotation value set (CORRECT / WRONG / NULL).
UPDATE "ContractReview" SET "diagramVerdict" = CASE "diagramVerdict"
  WHEN 'YES' THEN 'CORRECT'
  WHEN 'NO' THEN 'WRONG'
  WHEN 'CORRECT' THEN 'CORRECT'
  WHEN 'WRONG' THEN 'WRONG'
  ELSE NULL
END
WHERE "diagramVerdict" IS NOT NULL;
