import type { PhysicalStockRow } from "./types";

// Plain TS, safe to import from client and server code.

export const COLUMNS = [
  "DATE",
  "ERP CODE",
  "location",
  "L2-VALVE TYPE",
  "Dia",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-PN",
  "L8 -ITEM CATEGORY",
  "RECEIVED QTY.",
  "DISPATCH QTY.",
  "AVAILABLE QTY.",
  "REMARKS",
  "sum of PHYSICAL stock",
  "stock as per erp",
  "rate/unit",
  "rate per pc*qty*weight",
  "weight per pc",
  "item wise-value",
  "MOVING WITHIN 3 MONTHS",
  "Order Ag Approval recvd",
  "PURCHASE IN 26-27",
  "dispatched in 26-27",
  "ORDER IN hand QTY",
  "shortage qty",
  "",
  "item type",
  "PRICE",
  "MOQ",
  "IF LESS THAN MOQ- EXTRA CHARGES",
  "DRAWING/ TECHNICAL DATA",
  "COST",
  "BOM ID",
  "MAJOR/MINOR MARKING",
] as const;

export type PhysicalStockHeader = (typeof COLUMNS)[number];

// FIELDS[i] is the DB field of COLUMNS[i]: cell edits look the field up by
// column index and rowToArray renders cells in the same order.
export const FIELDS = [
  "form_date",
  "erp_code",
  "location",
  "l2_valve_type",
  "dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l7_dimension",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
  "available_qty",
  "remarks",
  "sum_of_physical_stock",
  "stock_as_per_erp",
  "rate_unit",
  "rate_per_pc_qty_weight",
  "weight_per_pc",
  "item_wise_value",
  "moving_within_3_months",
  "order_ag_approval_recvd",
  "purchase_in_26_27",
  "dispatched_in_26_27",
  "order_in_hand_qty",
  "shortage_qty",
  "unnamed_aa",
  "item_type",
  "price",
  "moq",
  "if_less_than_moq_extra_charges",
  "drawing_technical_data",
  "cost",
  "bom_id",
  "majorminor_marking",
] as const satisfies readonly (keyof PhysicalStockRow)[];

export type PhysicalStockField = (typeof FIELDS)[number];

export const fieldOf = (header: string): PhysicalStockField | undefined =>
  FIELDS[COLUMNS.indexOf(header as PhysicalStockHeader)];

export const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  "RECEIVED QTY.",
  "DISPATCH QTY.",
  "AVAILABLE QTY.",
  "sum of PHYSICAL stock",
  "stock as per erp",
  "rate/unit",
  "rate per pc*qty*weight",
  "weight per pc",
  "item wise-value",
  "PURCHASE IN 26-27",
  "dispatched in 26-27",
  "ORDER IN hand QTY",
  "shortage qty",
  "",
  "COST",
]);

/**
 * Every column an app may make editable. Sheet sync ignores these fields when
 * matching rows, so the set is fixed (not per app): both apps write the same
 * table and must agree on what makes a sheet row "new".
 * "ERP CODE" is only writable while blank; "BOM ID" goes through updateBomId.
 */
export const EDITABLE_CANDIDATES = [
  "ERP CODE",
  "DISPATCH QTY.",
  "REMARKS",
  "item type",
  "PRICE",
  "MOQ",
  "IF LESS THAN MOQ- EXTRA CHARGES",
  "DRAWING/ TECHNICAL DATA",
  "COST",
  "BOM ID",
] as const satisfies readonly PhysicalStockHeader[];

export type EditableHeader = (typeof EDITABLE_CANDIDATES)[number];

export function rowToArray(row: PhysicalStockRow): unknown[] {
  return FIELDS.map((field) => row[field] ?? "");
}

function parseNum(value: unknown): number | null {
  const s = String(value ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `rate/unit * available qty`, two decimals; a blank operand counts as 0. */
export function computeItemWiseValue(rateUnit: unknown, availableQty: unknown): string {
  return ((parseNum(rateUnit) ?? 0) * (parseNum(availableQty) ?? 0)).toFixed(2);
}

/** received - dispatch, or null when either is blank (leave available_qty alone). */
export function computeAvailableQty(received: unknown, dispatch: unknown): string | null {
  const r = parseNum(received);
  const d = parseNum(dispatch);
  return r === null || d === null ? null : String(r - d);
}

// l8_item_category (as stored in the stock DB, upper-cased) -> major/minor.
// Rules confirmed with product: finished valves, capital, gear box, trading
// valves, actuators, casting and pattern are major; everything else listed is
// minor. An unknown category returns null so callers leave the field alone.
const MAJOR_CATEGORIES = new Set([
  "FINISHED VALVES",
  "CAPITAL",
  "GEAR BOX",
  "TRADING VALVES",
  "ACTUATORS",
  "CASTING",
  "PATTERN",
]);

const MINOR_CATEGORIES = new Set([
  "BOLTS & NUTS",
  "MISCELLANEOUS",
  "BRONZE ITEMS",
  "PACKING MATERIALS",
  "RUBBER ITEMS",
  "SPARES",
  "SS SPARES",
  "TOOLS",
  "SCRAP",
]);

/** Major (true) / minor (false) marking for an item category; null when unknown. */
export function computeMajorMinorMarking(category: string | null | undefined): boolean | null {
  const c = (category ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (MAJOR_CATEGORIES.has(c)) return true;
  if (MINOR_CATEGORIES.has(c)) return false;
  return null;
}
