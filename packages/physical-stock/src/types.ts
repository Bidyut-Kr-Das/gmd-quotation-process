export interface PhysicalStockRow {
  id: string;
  /** ISO string; the server converts the DB Date. */
  form_date: string | null;
  erp_code: string | null;
  location: string | null;
  l2_valve_type: string | null;
  dimension: string | null;
  l7_dimension: string | null;
  l4_component: string | null;
  l5_material: string | null;
  l6_std: string | null;
  l8_item_category: string | null;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
  remarks: string | null;
  sum_of_physical_stock: string | null;
  stock_as_per_erp: string | null;
  rate_unit: string | null;
  rate_per_pc_qty_weight: string | null;
  weight_per_pc: string | null;
  item_wise_value: string | null;
  moving_within_3_months: string | null;
  order_ag_approval_recvd: string | null;
  purchase_in_26_27: string | null;
  dispatched_in_26_27: string | null;
  order_in_hand_qty: string | null;
  shortage_qty: string | null;
  unnamed_aa: string | null;
  item_type: string | null;
  price: string | null;
  moq: string | null;
  if_less_than_moq_extra_charges: string | null;
  drawing_technical_data: string | null;
  cost: string | null;
  bom_id: string | null;
  majorminor_marking: boolean | null;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PhysicalStockData {
  items: PhysicalStockRow[];
  /** Per-row BOM ID dropdown options; only apps with updateBomId send them. */
  bomIdOptions?: Record<string, string[]>;
}

export interface SyncSummary {
  created: number;
  skipped: number;
  totalRows: number;
  syncedAt: string;
}

export const NEW_ITEM_FIELDS = [
  "location",
  "l2_valve_type",
  "dimension",
  "l7_dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
] as const;

export type NewItemInput = Partial<Record<(typeof NEW_ITEM_FIELDS)[number], string>>;

/** Server Actions the host app passes in. Optional ones switch features on. */
export interface PhysicalStockActions {
  load: () => Promise<ActionResult<PhysicalStockData>>;
  sync: () => Promise<ActionResult<SyncSummary>>;
  updateField: (
    id: string,
    field: string,
    value: string | null,
  ) => Promise<ActionResult<Partial<PhysicalStockRow>>>;
  create?: (input: NewItemInput) => Promise<ActionResult<{ erp_code: string }>>;
  updateBomId?: (
    id: string,
    bomId: string | null,
  ) => Promise<ActionResult<Partial<PhysicalStockRow>>>;
}
