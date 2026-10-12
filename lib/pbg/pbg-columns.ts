export type ColumnType = "text" | "select" | "date" | "number";

export type ColumnKey =
  | "clientName"
  | "project"
  | "poNumber"
  | "poDate"
  | "bgNo"
  | "bgDate"
  | "bgAmtFc"
  | "expiryDate"
  | "claimDate"
  | "marginPct"
  | "marginAmount"
  | "contactPerson"
  | "contactNumber"
  | "remark"
  | "status";

export type FilterKind = "text" | "multiselect";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  type: ColumnType;
  align?: "left" | "right";
  width: number;
  /** How the header filter behaves. Defaults to "text" for text, "multiselect" for select. */
  filter?: FilterKind;
};

export const PBG_COLUMN_DEFS: ColumnDef[] = [
  { key: "clientName", label: "Client Name", type: "text", width: 220, filter: "multiselect" },
  { key: "project", label: "Project", type: "text", width: 150, filter: "multiselect" },
  { key: "poNumber", label: "PO Number", type: "text", width: 190 },
  { key: "poDate", label: "PO Date", type: "date", width: 115 },
  { key: "bgNo", label: "BG No", type: "text", width: 160 },
  { key: "bgDate", label: "BG Date", type: "date", width: 115 },
  { key: "bgAmtFc", label: "BG Amt (FC)", type: "number", align: "right", width: 130 },
  { key: "expiryDate", label: "Expiry Date", type: "date", width: 115 },
  { key: "claimDate", label: "Claim Date", type: "date", width: 115 },
  { key: "marginPct", label: "Margin %", type: "select", align: "right", width: 95 },
  { key: "marginAmount", label: "Margin Amount", type: "number", align: "right", width: 130 },
  { key: "contactPerson", label: "Contact Person", type: "text", width: 210 },
  { key: "contactNumber", label: "Contact Number", type: "text", width: 160 },
  { key: "remark", label: "Remark", type: "text", width: 300 },
  { key: "status", label: "Status", type: "select", width: 120 },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = PBG_COLUMN_DEFS.map(
  (column) => column.key,
);
