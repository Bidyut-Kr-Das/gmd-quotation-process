-- CreateTable
CREATE TABLE "gate_valve" (
    "id" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sizeMm" TEXT,
    "pnRatingClass" TEXT,
    "diaOfBonnetMin" TEXT,
    "diaOfBonnetMax" TEXT,
    "heightOfBonnetMm" TEXT,
    "faceToFaceLengthMm" TEXT,
    "faceToFaceLengthTolerance" TEXT,
    "flangeOdMm" TEXT,
    "flangeOdTolerance" TEXT,
    "pcdMm" TEXT,
    "pcdTolerance" TEXT,
    "numberOfBolts" TEXT,
    "boltDiameterMm" TEXT,
    "source" TEXT,
    "material" TEXT,
    "bodyPressure" TEXT,
    "durationBody" TEXT,
    "seatPressure" TEXT,
    "durationSeat" TEXT,
    "approxWeightKg" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_valve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flange" (
    "id" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "size" TEXT,
    "moc" TEXT,
    "pnRatingClass" TEXT,
    "wallThicknessMm" TEXT,
    "idMm" TEXT,
    "idTolerance" TEXT,
    "odMm" TEXT,
    "odTolerancePlus" TEXT,
    "odToleranceMinus" TEXT,
    "pcdMm" TEXT,
    "pcdTolerance" TEXT,
    "noOfHoleNos" TEXT,
    "holeDia" TEXT,
    "holeDiaTolerancePlus" TEXT,
    "holeDiaToleranceMinus" TEXT,
    "thicknessOfFlange" TEXT,
    "thicknessTolerancePlus" TEXT,
    "thicknessToleranceMinus" TEXT,
    "raisedFaceThicknessOfFlange" TEXT,
    "raisedFaceThicknessTolerancePlus" TEXT,
    "raisedFaceThicknessToleranceMinus" TEXT,
    "seatPressure" TEXT,
    "bodyPressure" TEXT,
    "standards" TEXT,
    "flangeType" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_box" (
    "id" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "typeOfValve" TEXT,
    "sizeOfValve" TEXT,
    "pnRating" TEXT,
    "torqueOfValve" TEXT,
    "torqueWithSafetyFactor" TEXT,
    "turnsToCloseValves" TEXT,
    "std" TEXT,
    "pcd" TEXT,
    "shaftLength" TEXT,
    "shaftDiaStemDia" TEXT,
    "sizeOfBase" TEXT,
    "boreDia" TEXT,
    "drillingDimension" TEXT,
    "gearBoxType" TEXT,
    "nmReqdRange" TEXT,
    "rmCode" TEXT,
    "approved" TEXT,
    "reqdBase" TEXT,
    "gearboxSerialNoEmerson" TEXT,
    "gearboxSerialNoViral" TEXT,
    "gearBoxOutputTorque" TEXT,
    "turnsToClose" TEXT,
    "mechAdvantage" TEXT,
    "ratio" TEXT,
    "maxDriveBore" TEXT,
    "weight" TEXT,
    "recommendedHandwheelMm" TEXT,
    "gearboxPriceEmerson" TEXT,
    "gearboxViral" TEXT,
    "actuatorModelNo" TEXT,
    "actuatorRpm" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gear_box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actuator" (
    "id" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "model" TEXT,
    "speed" TEXT,
    "ratedTq" TEXT,
    "size" TEXT,
    "poles" TEXT,
    "lrtCurrentInA" TEXT,
    "ratedTqCurrentInA" TEXT,
    "avgLoadCurrentInA" TEXT,
    "nominalKw" TEXT,
    "powerFactor" TEXT,
    "efficiency" TEXT,
    "olrSet" TEXT,
    "withInchingDuty" TEXT,
    "withoutInchingDuty" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actuator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "density" (
    "id" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "material" TEXT NOT NULL,
    "densityGmCm3" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "density_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_sync" (
    "tabKey" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,

    CONSTRAINT "engineering_sync_pkey" PRIMARY KEY ("tabKey")
);

-- CreateIndex
CREATE INDEX "gate_valve_syncedAt_idx" ON "gate_valve"("syncedAt");

-- CreateIndex
CREATE INDEX "flange_syncedAt_idx" ON "flange"("syncedAt");

-- CreateIndex
CREATE INDEX "gear_box_syncedAt_idx" ON "gear_box"("syncedAt");

-- CreateIndex
CREATE INDEX "actuator_syncedAt_idx" ON "actuator"("syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "density_material_key" ON "density"("material");

-- CreateIndex
CREATE INDEX "density_syncedAt_idx" ON "density"("syncedAt");
