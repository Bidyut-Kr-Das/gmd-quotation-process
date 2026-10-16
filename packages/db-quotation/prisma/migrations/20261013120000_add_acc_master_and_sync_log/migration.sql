-- CreateTable
CREATE TABLE "acc_master" (
    "id" TEXT NOT NULL,
    "acc_code" TEXT NOT NULL,
    "acc_name" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acc_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "financial_year" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "acc_misses" INTEGER NOT NULL DEFAULT 0,
    "ambiguous" INTEGER NOT NULL DEFAULT 0,
    "failed_writes" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_master_acc_code_key" ON "acc_master"("acc_code");

-- CreateIndex
CREATE INDEX "acc_master_synced_at_idx" ON "acc_master"("synced_at");

-- CreateIndex
CREATE INDEX "sync_log_kind_financial_year_idx" ON "sync_log"("kind", "financial_year");

-- CreateIndex
CREATE INDEX "sync_log_started_at_idx" ON "sync_log"("started_at");
