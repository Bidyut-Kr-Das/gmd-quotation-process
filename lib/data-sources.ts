export type SheetTab = {
  name: string;
  gid?: string;
  headerRow?: number;
  range?: string;
  note?: string;
  file?: string;
};

export type DataSource = {
  page: string;
  route?: string;
  dashboardName: string;
  sheetName: string;
  purpose?: string;
  envVar?: string;
  sheetId?: string;
  tabs: SheetTab[];
  appSheetUrl?: string;
  dbOnly?: boolean;
};

const GMD_ERP_MASTER_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SUPPLY_HISTORY_ID = "1aONKJmRM1bg14qPvtAoXelBbahUJVwnNs4dVPiEcbWs";
const CONTRACT_SHEET_ID = "1QYICFuOHx4ClMbEvyVtVT5DwmzpCy6HGuLNDwth5vN4";
const CONTRACT_REVIEW_ID = "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE";

export const DATA_SOURCES: DataSource[] = [
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard",
    sheetName: "GMD ERP Master (Item Code + BOM Cost)",
    purpose:
      "Reads Postgres, but auto-fills ERP item code / product cost by reading sheets directly.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      {
        name: "GMD Item Creation Form",
        gid: "2142407502",
        file: "lib/gmdItemCodeLookup.ts, gmdBomCostLookup.ts, gmd2to1CostLookup.ts",
      },
    ],
  },
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard (indirect RM cost)",
    sheetName: "Supply History",
    purpose: "RM cost read from DB, synced from this sheet.",
    sheetId: SUPPLY_HISTORY_ID,
    tabs: [{ name: "MASTER", note: "synced to DB; RM cost read from DB" }],
  },
  {
    page: "Raw Material",
    route: "/raw_material",
    dashboardName: "Raw Material Dashboard",
    sheetName: "GMD UPDATION (Raw Material)",
    purpose:
      "Edits the GMD UPDATION sheet (item catalogue); also validates NON CHAIN BOM and MRP/IS tabs.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      { name: "GMD UPDATION", note: "main data", file: "lib/gmd_lib/google-sheets.ts:fetchGMDUpdateSheet" },
      { name: "GMD Category", note: "dropdown helper", file: "fetchGMDCategorySheet" },
      { name: "stock-phys", note: "physical stock merge", file: "fetchStockPhysicalSheet" },
      { name: "NON CHAIN BOM", note: "presence validated", file: "fetchSheetMetadata" },
      { name: "MRP/IS", note: "presence validated", file: "fetchSheetMetadata" },
    ],
  },
  {
    page: "Supply History",
    route: "/supply_history",
    dashboardName: "Supply History Dashboard",
    sheetName: "Supply History",
    sheetId: SUPPLY_HISTORY_ID,
    tabs: [{ name: "MASTER", file: "app/api/supply-history/sync/route.ts" }],
  },
  {
    page: "Supply History",
    route: "/supply_history",
    dashboardName: "Supply History (ORDER LIST links)",
    sheetName: "Contract Sheet (attach-link helper)",
    sheetId: CONTRACT_SHEET_ID,
    tabs: [
      {
        name: "ORDER LINK helper",
        gid: "1367392830",
        note: "PO NO / ATTACH columns",
        file: "lib/gmd_lib/contract-order-links.ts:buildContractOrderLinkMap",
      },
    ],
  },
  {
    page: "Supply History",
    route: "/supply_history",
    dashboardName: "Supply History (ORDER LIST links — active source)",
    sheetName: "GMD Clientwise",
    sheetId: CONTRACT_REVIEW_ID,
    tabs: [
      {
        name: "CONTRACTS COPY",
        gid: "422553416",
        note: "fallbacks CONTRACTS / GMD CLIENTWISE",
        file: "lib/gmd_lib/contract-order-links.ts:buildGmdClientwiseOrderLinkMap",
      },
    ],
  },
  {
    page: "Contract Review",
    route: "/contract_review",
    dashboardName: "Contract Review Dashboard",
    sheetName: "Contract Review",
    sheetId: CONTRACT_REVIEW_ID,
    tabs: [
      { name: "CONTRACTS", gid: "734728893", headerRow: 4, file: "app/api/contract-review/sync/route.ts" },
      { name: "DUMP", gid: "1604813523", headerRow: 1, file: "app/api/contract-review/sync/route.ts" },
      { name: "IC DUMP", gid: "402078548", file: "scripts/sync-ic-dump.ts" },
    ],
  },
  {
    page: "Contract Review",
    route: "/contract_review",
    dashboardName: "Contract Review Dashboard (gap-fill seed)",
    sheetName: "BOM MAST ERP",
    purpose:
      "One-time gap-fill seed for ContractReview. Fills only fields that are blank in the DB; never overwrites. Not re-run after apply.",
    sheetId: "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544",
    tabs: [
      {
        name: "CONTRACT DUMP",
        gid: "1279116711",
        headerRow: 1,
        note: "one-time seed; 28/32 columns map (CONTRACT DATE -> dateOfContract alias)",
        file: "scripts/backfill-contract-review-contract-dump.ts",
      },
    ],
  },
  {
    page: "Indent Checking",
    route: "/indent_listing",
    dashboardName: "Indent Checking Dashboard",
    sheetName: "",
    purpose: "Derived from Contract Review data in the database.",
    dbOnly: true,
    tabs: [],
  },
  {
    page: "FG BOM",
    route: "/bom",
    dashboardName: "Verify BOM Dashboard",
    sheetName: "GMD ERP Master (BOM)",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      { name: "VERIFY BOM", range: "A2:ZZZ", file: "app/api/bom/sync/route.ts" },
      { name: "GMD Item Creation Form", gid: "2142407502", note: "metadata sync", file: "app/api/bom/sync-meta/route.ts" },
      {
        name: "stock-phys",
        note: "available stock gap-fill",
        file: "syncNullVerifyBomStockAction (app/actions.ts:3701)",
      },
    ],
  },
  {
    page: "BIS Status",
    route: "/bis-status",
    dashboardName: "BIS Status Dashboard",
    sheetName: "",
    purpose: "Stored entirely in the database.",
    dbOnly: true,
    tabs: [],
  },
  {
    page: "Upload Image",
    route: "/upload-image",
    dashboardName: "Upload Image",
    sheetName: "",
    purpose: "Image uploads stored in S3 + database.",
    dbOnly: true,
    tabs: [],
  },
  {
    page: "Admin",
    route: "/admin/lookup-options",
    dashboardName: "Admin (Lookup Options)",
    sheetName: "",
    purpose: "Lookup option CRUD stored in the database.",
    dbOnly: true,
    tabs: [],
  },
  {
    page: "Sale Bill (optional script)",
    dashboardName: "Sale Bill import",
    sheetName: "Sale Bill",
    envVar: "SALE_BILL_SPREADSHEET_ID",
    tabs: [{ name: "GID 0", gid: "0" }],
  },
];

export function resolveSheetId(source: DataSource): string | null {
  if (source.sheetId) return source.sheetId;
  if (source.envVar) {
    const id = process.env[source.envVar];
    if (id) return id;
  }
  return null;
}

export function sheetEditUrl(sheetId: string, gid?: string): string {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return gid ? `${base}#gid=${gid}` : base;
}