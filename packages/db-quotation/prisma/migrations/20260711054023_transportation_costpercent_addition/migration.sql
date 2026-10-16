-- CreateTable
CREATE TABLE "TransportationCost" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "fullLoad" TEXT NOT NULL,
    "partLoad" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportationCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransportationCost_state_key" ON "TransportationCost"("state");
