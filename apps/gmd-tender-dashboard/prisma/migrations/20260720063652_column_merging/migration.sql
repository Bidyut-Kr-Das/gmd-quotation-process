-- CreateTable
CREATE TABLE "column_groups" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "separator" TEXT NOT NULL DEFAULT ' @ ',
    "fields" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "column_groups_pkey" PRIMARY KEY ("id")
);
