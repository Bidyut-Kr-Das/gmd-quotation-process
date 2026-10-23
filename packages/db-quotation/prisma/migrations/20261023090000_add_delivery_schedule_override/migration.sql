-- True once a user picks Delivery Schedule by hand. The sync re-derives the
-- value only while this is false.
ALTER TABLE "EnquiryItem" ADD COLUMN "deliveryScheduleOverride" BOOLEAN NOT NULL DEFAULT false;
