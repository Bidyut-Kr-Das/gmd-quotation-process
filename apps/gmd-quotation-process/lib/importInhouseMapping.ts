import { matchItemType } from "./itemTypePatterns";
import { toNumber } from "./deliverySchedule";

export type ImportedInhouse = "DOMESTIC" | "IMPORT" | "INHOUSE";

export interface ImportInhouseRule {
  value: ImportedInhouse;
  /** Inclusive lower size bound (mm). Omitted = no lower bound. */
  min?: number;
  /** Inclusive upper size bound (mm). Omitted = no upper bound. */
  max?: number;
}

/**
 * ITEM TYPES x SIZES -> IMPORT/IN HOUSE mapping, transcribed from
 * "item type list (1) (1).xlsx" and keyed by the canonical `EnquiryItem.itemType`
 * values produced by lib/itemTypePatterns.ts.
 *
 * Only entries present in the sheet are listed. Any type not present resolves to
 * null (which the delivery-schedule logic treats as its default fallback).
 */
export const ITEM_IMPORT_INHOUSE: Record<string, ImportInhouseRule[]> = {
  // ---- IMPORT ----
  TPAV: [{ value: "IMPORT" }],
  "KNIFE GATE VALVE": [{ value: "IMPORT" }],
  "SLUICE VALVE-METAL-RISING": [{ value: "IMPORT" }],
  "SLUICE VALVE-METAL-NON-RISING": [{ value: "IMPORT" }],
  "SLUICE VALVE-RESILIENT-RISING": [{ value: "IMPORT" }],
  "SLUICE VALVE-RESILIENT-NON-RISING": [{ value: "IMPORT" }],
  "GLOBE VALVE": [{ value: "IMPORT" }],
  "CHECK VALVE": [{ value: "IMPORT" }],
  "AIR VALVE": [{ value: "IMPORT" }],
  "VACUM BREAKER VALVE": [{ value: "IMPORT" }],
  "SOLENOID VALVE": [{ value: "IMPORT" }],
  "FOOT VALVE": [{ value: "IMPORT" }],
  "FLOAT VALVE": [{ value: "IMPORT" }],
  "ZERO VELOCITY VALVE": [{ value: "IMPORT" }],
  "ALTITUDE CONTROL VALVE": [{ value: "IMPORT" }],
  "PRESSURE REDUCING VALVE": [{ value: "IMPORT" }],
  "PRESSURE RELIEF VALVE": [{ value: "IMPORT" }],
  "EXPANSION BELOWS": [{ value: "IMPORT" }],
  "Y-STRAINER": [{ value: "IMPORT" }],
  "H.P. ORIFICE SMALL CHAMBER": [{ value: "IMPORT" }],
  "SMALL ORIFICE SET": [{ value: "IMPORT" }],
  BUSH: [{ value: "IMPORT" }],
  "AIR CUSHION VALVE": [{ value: "IMPORT" }], // sheet: "CUSHION"

  // ---- DOMESTIC ----
  "BALL VALVE": [{ value: "DOMESTIC" }],
  "COMPANION FLANGE": [{ value: "DOMESTIC" }],
  "NEEDLE VALVE": [{ value: "DOMESTIC" }],
  "FIRE HYDRANT VALVE": [{ value: "DOMESTIC" }],
  "SLUICE GATE": [{ value: "DOMESTIC" }],
  GASKET: [{ value: "DOMESTIC" }],
  "DISMANTLING JOINT": [{ value: "DOMESTIC" }],
  "GEAR BOX": [{ value: "DOMESTIC" }],
  "O-RING": [{ value: "DOMESTIC" }],
  SHAFT: [{ value: "DOMESTIC" }],
  WASHER: [{ value: "DOMESTIC" }],
  "DOWEL PIN & WASHER": [{ value: "DOMESTIC" }],
  RING: [{ value: "DOMESTIC" }],
  "DEAD END COVER": [{ value: "DOMESTIC" }],
  "DRUM PLATE": [{ value: "DOMESTIC" }],
  "MS REDUCER": [{ value: "DOMESTIC" }],
  "MS ROD": [{ value: "DOMESTIC" }],
  "LP SEAT RING": [{ value: "DOMESTIC" }],
  GAZAL: [{ value: "DOMESTIC" }],
  WASTAGE: [{ value: "DOMESTIC" }],
  "DIGITAL PRESSURE GAUGE": [{ value: "DOMESTIC" }],
  DPCV: [{ value: "DOMESTIC" }],
  OTHERS: [{ value: "DOMESTIC" }],

  // ---- size-dependent ----
  "BUTTERFLY VALVE": [
    { value: "IMPORT", max: 450 },
    { value: "INHOUSE", min: 500 },
  ],
};

/** Sheet names that are not themselves canonical item types. */
const ALIASES: Record<string, string> = {
  "BUSH PLATE": "BUSH",
  CUSHION: "AIR CUSHION VALVE",
};

function normalizeType(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function lookupRules(type: string): ImportInhouseRule[] | undefined {
  const key = normalizeType(type);
  return ITEM_IMPORT_INHOUSE[ALIASES[key] ?? key];
}

/**
 * Resolves the import/in-house classification for an item from its canonical
 * itemType + size (mm). Falls back to matching the raw itemName when the
 * itemType is missing or unknown. Returns null when no rule applies.
 */
export function resolveImportedInhouse(
  itemType: string | null | undefined,
  size: string | number | null | undefined,
  itemName?: string | null
): ImportedInhouse | null {
  let rules = itemType ? lookupRules(itemType) : undefined;

  if (!rules && itemName) {
    const matched = matchItemType(itemName);
    if (matched) rules = lookupRules(matched);
  }

  if (!rules || rules.length === 0) return null;

  const sizeNum = toNumber(size);

  for (const rule of rules) {
    const hasMin = typeof rule.min === "number";
    const hasMax = typeof rule.max === "number";

    // Unbounded rule applies to all sizes.
    if (!hasMin && !hasMax) return rule.value;

    // Bounded rule cannot be evaluated without a numeric size.
    if (sizeNum === null) continue;

    if (hasMin && sizeNum < (rule.min as number)) continue;
    if (hasMax && sizeNum > (rule.max as number)) continue;
    return rule.value;
  }

  return null;
}
