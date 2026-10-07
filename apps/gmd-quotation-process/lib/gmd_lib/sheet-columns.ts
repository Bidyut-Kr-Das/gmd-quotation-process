export const CANONICAL_COLUMNS = [
  
  "ERP ITEM CODE",
  "ITEM NAME (proposed)-AUTO",
  "L1",
  "L2-VALVE TYPE",
  "L3-DIA",
  "L7-DIMENSION",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
   "L8 -ITEM CATEGORY",
  "UM",
  "Available Stock",
  "CONV",
  "1 pcs wgt",
  "AUM",
  "cost",
  "USD cost",
  "HSN CODE",
  "HSN Code Validation",
  "CONV",
  "MAJOR MARKING",
  "NEW ITEM STATUS",
  "CURRENT STATUS",
  "RM TYPE",
  "INDIAN/IMPORTED",
  "Order Qty",
];

export const STATUS_COLUMNS = new Set(["NEW ITEM STATUS", "CURRENT STATUS", "RM TYPE","INDIAN/IMPORTED" ]);
export const NUMERIC_COLUMNS = new Set(["Available Stock", "cost", "1 pcs wgt", "USD cost"]);

export const RM_TYPE_OPTIONS: string[] = [
  "1538",
  "9523",
  "ANSI",
  "COMMON",
  "WAFER TYPE",
  "ACT WIS",
  "ACT WOS",
  "ACT SPH",
  "ACT SPC",
  "ACT WIS-F",
  "GB SPUR",
  "GB WORM",
  "CAP",
  "CONS",
];

export const FIXED_DROPDOWN_OPTIONS: Record<string, string[]> = {
  "NEW ITEM STATUS": ["Updated"],
  "RM TYPE": RM_TYPE_OPTIONS,
};

/**
 * Extra L7-DIMENSION options, merged on top of the GMD Category sheet list and
 * the Trading Valve cascade.
 *
 * Kept here rather than in the page because both `app/raw_material/page.tsx` and
 * `getTradingValveOptionsAction` (`app/actions.ts`) need the same list — the
 * cascade is the Transferred Items table's source for L7, so adding the value
 * only client-side would leave the cascade without it.
 *
 * NOT to be added to FIXED_DROPDOWN_OPTIONS: that map takes priority over
 * `categoryOptions` in GMDUpdateTable, so it would REPLACE the sheet's L7 list
 * rather than extend it.
 */
export const HARDCODED_L7_OPTIONS: string[] = ["SA25A22-RPM22"];

/**
 * Extends `options["L7-DIMENSION"]` with HARDCODED_L7_OPTIONS, append-only.
 *
 * Safe to apply repeatedly and to an options map that has no L7 entry at all.
 * Returns the input unchanged when every extra is already present, so callers
 * wrapped in `useMemo` keep referential stability.
 */
export function withHardcodedL7Options(
  options: Record<string, string[]>,
): Record<string, string[]> {
  const existing = options["L7-DIMENSION"] ?? [];
  const missing = HARDCODED_L7_OPTIONS.filter((v) => !existing.includes(v));
  return missing.length === 0
    ? options
    : { ...options, "L7-DIMENSION": [...existing, ...missing] };
}

export const COL_INDEX_TO_DB_FIELD: Record<number, string> = {
  0: "erpItemCode",
  1: "itemNameAuto",
  2: "l1",
  3: "l2ValveType",
  4: "l3Dia",
  5: "l7Dimension",
  6: "l4Component",
  7: "l5Material",
  8: "l6Std",
  9: "l8ItemCategory",
  10: "um",
  11: "availableStock",
  12: "conv1",
  13: "pcsWgt",
  14: "aum",
  15: "cost",
  16: "usdRateOption",
  17: "hsnCode",
  18: "hsnCodeValidation",
  19: "conv2",
  20: "majorMarking",
  21: "newItemStatus",
  22: "currentStatus",
  23: "rmType",
  24: "indianImported",
  25: "orderDelivery",
};

export function resolveGMDUpdateField(
  headers: string[],
  colIndex: number,
): string | null {
  const header = headers[colIndex];
  if (!header) return null;
  switch (header) {
    case "ITEM NAME (derived)":
      return "itemNameDerived";
    case "BOM ID":
      return "bomId";
    case "Vendor Reference":
      return "vendorReference";
    case "Attachment":
      return "attachmentUrl";
  }
  const derivedIdx = headers.indexOf("ITEM NAME (derived)");
  const canonical =
    derivedIdx !== -1 && colIndex > derivedIdx ? colIndex - 1 : colIndex;
  return COL_INDEX_TO_DB_FIELD[canonical] ?? null;
}
