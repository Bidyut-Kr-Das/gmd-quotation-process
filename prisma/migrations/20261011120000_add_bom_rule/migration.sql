-- CreateTable
CREATE TABLE "BomRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bomMode" TEXT NOT NULL DEFAULT 'PER_MATCH',
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomRule_pkey" PRIMARY KEY ("id")
);
