import { ENGINEERING_TABS } from "./tableConfig";

/**
 * The bridge between the sheet's positional rows and the typed Prisma models.
 *
 * Each entry lists the Prisma field names for one tab, **in the same order as
 * that tab's captions in `tableConfig.ts`**. Because it is a single ordered
 * list, it drives both directions — sheet row -> DB record on sync, and DB
 * record -> row array on read — so a column cannot be written to one field and
 * read back from another.
 *
 * Server-side only (it exists to pair with `lib/technical/syncEngineering.ts`
 * and `lib/technical/engineeringData.ts`); nothing in the browser imports it.
 */
export const TAB_FIELDS: Record<string, readonly string[]> = {
  "gate-valve": [
    "sizeMm",
    "pnRatingClass",
    "diaOfBonnetMin",
    "diaOfBonnetMax",
    "heightOfBonnetMm",
    "faceToFaceLengthMm",
    "faceToFaceLengthTolerance",
    "flangeOdMm",
    "flangeOdTolerance",
    "pcdMm",
    "pcdTolerance",
    "numberOfBolts",
    "boltDiameterMm",
    "source",
    "material",
    "bodyPressure",
    "durationBody",
    "seatPressure",
    "durationSeat",
    "approxWeightKg",
  ],
  flange: [
    "size",
    "moc",
    "pnRatingClass",
    "wallThicknessMm",
    "idMm",
    "idTolerance",
    "odMm",
    "odTolerancePlus",
    "odToleranceMinus",
    "pcdMm",
    "pcdTolerance",
    "noOfHoleNos",
    "holeDia",
    "holeDiaTolerancePlus",
    "holeDiaToleranceMinus",
    "thicknessOfFlange",
    "thicknessTolerancePlus",
    "thicknessToleranceMinus",
    "raisedFaceThicknessOfFlange",
    "raisedFaceThicknessTolerancePlus",
    "raisedFaceThicknessToleranceMinus",
    "seatPressure",
    "bodyPressure",
    "standards",
    "flangeType",
    // Display-only columns (sheet AA..AK), mirroring FLANGE_COLUMNS order.
    "densityGmCm3",
    "totalWeightKg",
    "totalWeightTolerancePlus",
    "totalWeightApproxAsPerIs",
    "totalWeightToleranceMinus",
    "costAsPerIs",
    "boltLengthMm",
    "boltDiaMm",
    "boltWeightCsKg",
    "boltWeightSsKg",
    "boltWeightAsKg",
  ],
  "gear-box": [
    "typeOfValve",
    "sizeOfValve",
    "pnRating",
    "torqueOfValve",
    "torqueWithSafetyFactor",
    "turnsToCloseValves",
    "std",
    "pcd",
    "shaftLength",
    "shaftDiaStemDia",
    "sizeOfBase",
    "boreDia",
    "drillingDimension",
    "gearBoxType",
    "nmReqdRange",
    "rmCode",
    "approved",
    "reqdBase",
    "gearboxSerialNoEmerson",
    "gearboxSerialNoViral",
    "gearBoxOutputTorque",
    "turnsToClose",
    "mechAdvantage",
    "ratio",
    "maxDriveBore",
    "weight",
    "recommendedHandwheelMm",
    "gearboxPriceEmerson",
    "gearboxViral",
    "actuatorModelNo",
    "actuatorRpm",
  ],
  actuator: [
    "model",
    "speed",
    "ratedTq",
    "size",
    "poles",
    "lrtCurrentInA",
    "ratedTqCurrentInA",
    "avgLoadCurrentInA",
    "nominalKw",
    "powerFactor",
    "efficiency",
    "olrSet",
    "withInchingDuty",
    "withoutInchingDuty",
  ],
  density: ["material", "densityGmCm3"],
};

/**
 * Fail loudly at module load if a tab's field list drifts from its captions.
 * A mismatch would otherwise show up as silently shifted columns in the UI, or
 * a Prisma error at sync time.
 */
for (const tab of ENGINEERING_TABS) {
  const fields = TAB_FIELDS[tab.key];
  if (!fields) {
    throw new Error(
      `engineeringModels: no field mapping for tab "${tab.key}". Add one to TAB_FIELDS.`,
    );
  }
  if (fields.length !== tab.columns.length) {
    throw new Error(
      `engineeringModels: tab "${tab.key}" has ${tab.columns.length} columns ` +
        `but ${fields.length} mapped fields.`,
    );
  }
}

/** Sheet row (positional) -> Prisma record (named). Empty cells become "". */
export function rowToRecord(
  tabKey: string,
  row: unknown[],
): Record<string, string> {
  const fields = TAB_FIELDS[tabKey];
  if (!fields) throw new Error(`Unknown engineering tab: ${tabKey}`);
  const record: Record<string, string> = {};
  fields.forEach((field, i) => {
    const value = row[i];
    record[field] = value == null ? "" : String(value);
  });
  return record;
}

/** Prisma record (named) -> sheet row (positional), in caption order. */
export function recordToRow(
  tabKey: string,
  record: Record<string, unknown>,
): unknown[] {
  const fields = TAB_FIELDS[tabKey];
  if (!fields) throw new Error(`Unknown engineering tab: ${tabKey}`);
  return fields.map((field) => record[field] ?? "");
}
