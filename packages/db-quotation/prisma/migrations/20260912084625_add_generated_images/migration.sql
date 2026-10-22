-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "itemType" TEXT,
    "operationType" TEXT,
    "rmType" TEXT,
    "imageKey" TEXT NOT NULL,
    "url" TEXT,
    "driveFileId" TEXT,
    "prompt" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_imageKey_key" ON "GeneratedImage"("imageKey");

-- CreateIndex
CREATE INDEX "GeneratedImage_itemType_idx" ON "GeneratedImage"("itemType");

-- CreateIndex
CREATE INDEX "GeneratedImage_operationType_idx" ON "GeneratedImage"("operationType");

-- CreateIndex
CREATE INDEX "GeneratedImage_rmType_idx" ON "GeneratedImage"("rmType");

-- CreateIndex
CREATE INDEX "GeneratedImage_status_idx" ON "GeneratedImage"("status");
