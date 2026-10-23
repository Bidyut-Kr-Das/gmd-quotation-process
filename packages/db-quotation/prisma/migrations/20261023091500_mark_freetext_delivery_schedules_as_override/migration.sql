-- Pre-flag rows may already carry a hand-typed value. Treat anything outside the
-- derived vocabulary as manual so the first sync cannot flatten it to the default.
-- The vocabulary lives in lib/deliverySchedule.ts.
UPDATE "EnquiryItem"
SET "deliveryScheduleOverride" = true
WHERE "deliverySchedule" IS NOT NULL
  AND btrim("deliverySchedule") <> ''
  AND btrim("deliverySchedule") NOT IN (
    '2-3 weeks',
    '2 months',
    '3 months',
    'Min. 3 to 4 months'
  );
