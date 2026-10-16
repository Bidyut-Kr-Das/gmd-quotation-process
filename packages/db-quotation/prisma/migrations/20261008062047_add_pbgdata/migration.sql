-- CreateTable
CREATE TABLE "pbg_data" (
    "id" BIGSERIAL NOT NULL,
    "client_name" TEXT,
    "project" TEXT,
    "po_number" TEXT,
    "po_date" DATE,
    "bg_no" TEXT,
    "bg_date" DATE,
    "bg_amt_fc" DECIMAL(18,2),
    "expiry_date" DATE,
    "claim_date" DATE,
    "margin_pct" DECIMAL(8,2),
    "margin_amount" DECIMAL(18,2),
    "contact_person" TEXT,
    "contact_number" TEXT,
    "remark" TEXT,
    "status" TEXT,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pbg_data_pkey" PRIMARY KEY ("id")
);
