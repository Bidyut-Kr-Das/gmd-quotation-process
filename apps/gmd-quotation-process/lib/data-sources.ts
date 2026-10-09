export type SheetTab = {
  name: string;
  gid?: string;
  headerRow?: number;
  range?: string;
  note?: string;
  file?: string;
  /** How the code addresses this tab. Title-resolved tabs break if renamed. */
  resolvedBy?: "gid" | "title";
};

/** Where the data flows. */
export type SyncDirection =
  | "sheet-to-db"
  | "db-to-db"
  | "db-only"
  | "read-only"
  | "external-api";

/** What causes the operation to run. */
export type SyncTrigger =
  | "page-load"
  | "button"
  | "api-only"
  | "manual-script"
  | "none";

export type SyncKind =
  | "sync"
  | "seed"
  | "derived"
  | "edit"
  | "backfill"
  | "cleanup"
  | "lookup"
  | "script"
  | "diagnostic";

/**
 * One sheet column and the Prisma field it lands in. `sheetHeader` must be the
 * literal header string in the spreadsheet, not the display caption.
 */
export type ColumnMapping = {
  sheetHeader: string;
  dbField: string;
  note?: string;
};

export type SyncOperation = {
  /** Stable key for React list rendering. */
  id: string;
  name: string;
  kind: SyncKind;
  file: string;
  line?: string;
  /** One sentence: what this operation is for. */
  purpose: string;
  direction: SyncDirection;
  trigger: SyncTrigger;
  /** Human-readable trigger, e.g. "Sync button" or "npm run ic:sync:apply". */
  triggerLabel: string;
  sheetTab?: string;
  sheetGid?: string;
  sheetRange?: string;
  headerRow?: number;
  columns?: ColumnMapping[];
  dbModels: string[];
  /** Exact rule for what gets written vs kept. */
  writePolicy: string;
  cadence: "every-sync" | "every-page-load" | "one-time" | "manual" | "on-demand";
  npmCommand?: string;
  /** True when the script defaults to a no-write preview. */
  dryRunDefault?: boolean;
  /** No runtime caller anywhere in the repo. */
  dead?: boolean;
  /** Other pages / actions that share this same code path. */
  sharedWith?: string;
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
  sync?: SyncOperation[];
};

const GMD_ERP_MASTER_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SUPPLY_HISTORY_ID = "1aONKJmRM1bg14qPvtAoXelBbahUJVwnNs4dVPiEcbWs";
const CONTRACT_SHEET_ID = "1QYICFuOHx4ClMbEvyVtVT5DwmzpCy6HGuLNDwth5vN4";
const CONTRACT_REVIEW_ID = "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE";
const BOM_MAST_ERP_ID = "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";

/** Compact tuple builder so the column tables below stay readable. */
function cols(
  ...pairs: ([string, string] | [string, string, string])[]
): ColumnMapping[] {
  return pairs.map(([sheetHeader, dbField, note]) => ({
    sheetHeader,
    dbField,
    ...(note ? { note } : {}),
  }));
}

/* ------------------------------------------------------------------ *
 * Reusable column-mapping fragments
 * ------------------------------------------------------------------ */

/** GMD UPDATION -> GMDUpdateItem. Canonical order = sheet-columns.ts. */
const GMD_UPDATION_COLUMNS = cols(
  ["ERP ITEM CODE", "erpItemCode", "join key; blank-code rows skipped"],
  ["ITEM NAME (proposed)-AUTO", "itemNameAuto"],
  ["L1", "l1"],
  ["L2-VALVE TYPE", "l2ValveType"],
  ["L3-DIA", "l3Dia"],
  ["L7-DIMENSION", "l7Dimension"],
  ["L4-COMPONENT", "l4Component"],
  ["L5- MATERIAL", "l5Material"],
  ["L6-STD", "l6Std"],
  ["L8 -ITEM CATEGORY", "l8ItemCategory", "leading space in the canonical name"],
  ["UM", "um"],
  ["Available Stock", "availableStock", "overridden by stock-phys, then user-editable"],
  ["CONV", "conv1", "1st CONV — first-unused match"],
  ["1 pcs wgt", "pcsWgt"],
  ["AUM", "aum"],
  ["cost", "cost"],
  ["USD cost", "usdRateOption", '"0" is stored as null'],
  ["HSN CODE", "hsnCode"],
  ["HSN Code Validation", "hsnCodeValidation"],
  ["CONV", "conv2", "2nd CONV — duplicate header"],
  ["MAJOR MARKING", "majorMarking"],
  ["NEW ITEM STATUS", "newItemStatus", "drives the 3-table split"],
  ["CURRENT STATUS", "currentStatus"],
  ["RM TYPE", "rmType"],
  ["INDIAN/IMPORTED", "indianImported"],
  ["Order Qty", "orderDelivery", "declared but never read from the sheet"],
);

/** MASTER -> SupplyHistoryItem. 39 of the 44 canonical headers are read. */
const SUPPLY_MASTER_COLUMNS = cols(
  ["item name", "itemName", "NOT NULL — second half of the join key"],
  ["INVOICE NO", "invoiceNo", "NOT NULL — first half of the join key"],
  ["FINANCIAL YEAR", "financialYear"],
  ["party name", "partyName"],
  ["ERP PARTY NAME", "erpPartyName", "synced but never displayed"],
  ["Date", "date", "stored as DD-Mmm-YY"],
  ["PARTY Order No.", "partyOrderNo", "lookup key for ORDER LIST"],
  ["PARTY Date", "partyDate"],
  ["Quantity", "quantity"],
  ["UOM", "uom"],
  ["Value", "value"],
  ["Gross Total- INVOICE VALUE", "grossTotalInvoiceValue"],
  ["LR NO & DT", "lrNoDt"],
  ["DELIVERY DESTINATION", "deliveryDestination"],
  ["CONSIGNEE ADDRESS", "consigneeAddress"],
  ["CONSIGNEE NAME", "consigneeName"],
  ["ERP CONTRACT NO", "erpContractNo"],
  ["ERP ITEM CODE", "erpItemCode", "RM-cost + cBatch lookup key"],
  ["TYPE OF VALVE", "typeOfValve", "merged over derivedItemType on display"],
  ["SIZE OF VALVE", "sizeOfValve", "merged over derivedSize on display"],
  ["CLASS OF VALVE", "classOfValve"],
  ["SPARES (TYPE)", "sparesType"],
  ["MOC", "moc", "1st MOC — merged over derivedMoc on display"],
  ["ORDER COPY", "orderCopy", "synced but never displayed"],
  ["INVOICE", "invoice"],
  ["INSPECTION REPORT", "inspectionReport"],
  ["State", "state", "gap-fill only"],
  ["UTILITY", "utility", "gap-fill only"],
  ["performance certificate", "performanceCertificate"],
  ["service period complete", "servicePeriodComplete"],
  ["WARRANTY VALID TILL AS PER CONTRACT", "warrantyValidTillAsPerContract"],
  ["Warranty valid/Not", "warrantyValidNot"],
  ["BG NO", "bgNo"],
  ["PBG VALID TILL", "pbgValidTill"],
  ["as per order warranty period", "asPerOrderWarrantyPeriod"],
  ["PBG CLAIM TILL", "pbgClaimTill"],
  ["PBG AMOUNT", "pbgAmount"],
  ["Warranty Exp Date as Per Inv", "warrantyExpDateAsPerInv"],
  ["Party Mail Address", "partyMailAddress", "gap-fill only"],
);

/** The 5 canonical headers MASTER declares but the sync never reads. */
const SUPPLY_MASTER_UNREAD = cols(
  ["Item Type", "(not read)", "maps to derivedItemType — script/UI only"],
  ["MOC", "(not read)", "2nd MOC — always logs as an unmapped header"],
  ["Size", "(not read)", "maps to derivedSize — script/UI only"],
  ["ORDER LIST", "orderList", "written from GMD Clientwise, not MASTER"],
  ["C BATCH", "cBatch", "written by the C-Batch sync only"],
);

/** CONTRACTS tab -> ContractReview (canonical index order). */
const CONTRACTS_COLUMNS = cols(
  ["CONTRACT NO", "contractNo", "NOT NULL — join key, immutable on update"],
  ["ITEM_CODE", "itemCode", "NOT NULL — join key, immutable on update"],
  ["MC NO", "mcNo"],
  ["ITEM_NAME", "itemName"],
  ["PARTY ITEM NAME", "partyItemName"],
  ["RATE", "rate"],
  ["CV", "cv", "hidden column"],
  ["VA %", "vaPercent", "hidden column"],
  ["ORDER QTY", "orderQty", "falls back to DUMP!ORDER QTY"],
  ["FREE STOCK", "freeStock", "hidden column"],
  ["FINAL REQ", "finalReq", "hidden column"],
  ["MC QTY", "mcQty", "falls back to DUMP!MC QTY"],
  ["Balance mc", "balanceMc", "hidden column"],
  ["PROD ORD QTY", "prodOrdQty", "hidden column"],
  ["BALANCE TO PROD ORD", "balanceToProdOrd", "hidden column"],
  ["BALANCE TO PROD ENT", "balanceToProdEnt", "hidden column"],
  ["DI QTY", "diQty", "falls back to DUMP!DI QTY"],
  ["BILLED QTY", "billedQty", "falls back to DUMP!BILLED QTY"],
  ["BAL BILL AG MC", "(dead)", "CONTRACTS idx 18 is never read — DUMP idx 10 wins"],
  ["BAL BILL AG CONT", "balBillAgCont", '"is the contract closed" signal'],
  ["Item", "item", "gap-fill only"],
  ["VALUE", "value"],
  ["SIZE", "size"],
  ["PN RATING", "pnRating", "gap-fill only"],
  ["DATE OF CONTRACT", "dateOfContract", "gap-fill only, dd-MMM-yyyy"],
  ["CLEARANCE STATUS", "clearanceStatus", "gap-fill only; also the drawing hyperlink"],
  ["Actuator", "actuator", "gap-fill only — format L7@L6"],
  ["RM CODE FOR ACTUATOR", "(skipped)", "SKIP_FIELDS — read then discarded"],
  ["RM CODE FOR GB", "rmCodeForGb"],
  ["PAYMENT TERMS", "paymentTerms", "gap-fill only"],
  ["LC/RTGS REF NO", "lcRtgsRefNo", "gap-fill only"],
  ["LC DATE/RTGS DATE", "lcDateRtgsDate", "gap-fill only"],
  ["LAST DATE OF SHIPMENT/DATE OF LC", "lastDateOfShipmentDateOfLc", "gap-fill only"],
  ["Issuing bank name", "issuingBankName", "gap-fill only"],
  ["bom formula trial", "bomFormulaTrial", "gap-fill only"],
  ["ERP PARTY NAME FROM GMD SUPPLY HISTORY", "erpPartyNameFromGmdSupplyHistory"],
  ["BOM NATURE", "(skipped)", "fills itemType then SKIP_FIELDS discards it"],
  ["STATUS", "status", "blank means Live; hidden column"],
  ["STATUS OF BOM", "(filter)", "not canonical — only a closed-row skip filter"],
);

/** DUMP tab -> ContractReview (canonical index order). */
const DUMP_COLUMNS = cols(
  ["JOB Code", "jobCode", "hidden column"],
  ["BAL DI QTY", "balDiQty", "hidden column"],
  ["BAL MC VAL", "balMcVal", "hidden column"],
  ["BAL PROD ORD VAL", "balProdOrdVal", "hidden column"],
  ["BAL TO PROD ORD ENT VAL", "balToProdOrdEntVal", "hidden column"],
  ["BAL BILL AG MC VAL", "balBillAgMcVal", "hidden column"],
  ["BAL BILL AG CONT VAL", "balBillAgContVal", "hidden column"],
  ["BAL DI VAL", "balDiVal", "hidden column"],
  ["DI VAL", "diVal", "hidden column"],
  ["ic qty", "icQty", "hidden column"],
  ["BAL BILL AG MC", "balBillAgMc", "the real source — CONTRACTS idx 18 is dead"],
  ["DI QTY", "diQty", "fallback when CONTRACTS is blank"],
  ["MC QTY", "mcQty", "fallback when CONTRACTS is blank"],
  ["BILLED QTY", "billedQty", "fallback when CONTRACTS is blank"],
  ["ORDER QTY", "orderQty", "fallback when CONTRACTS is blank"],
  ["PARTY NAME", "partyNameDump", "display PARTY NAME + Enquiry join key"],
);

/** INSPECTION OFFER DUMP tab -> ContractReview array columns. */
const IC_DUMP_COLUMNS = cols(
  ["VRNO", "offerNumber[]", "col A; comma-split, unioned, normalized dedupe"],
  ["ITEM_CODE", "(join key)", "col C; first half of MC NO||ITEM_CODE"],
  ["CONTRACT_VRNO", "(join key)", "col G; half 2 of the key, stored as ContractReview.mcNo"],
  ["INSPE_VRNO", "inspectionNumber[]", "col H; comma-split, unioned"],
  ["DI_DATE", "diDate[]", "col K; comma-split, unioned"],
);

/** VERIFY BOM tab -> VerifyBom. Only 8 of the 26 headers are read. */
const VERIFY_BOM_SYNC_COLUMNS = cols(
  ["BOM ID", "bomId", "upsert key part; blank rows skipped"],
  ["ITEM CODE", "itemCode", "upsert key part; blank rows skipped"],
  ["ITEM NAME", "itemName"],
  ["ITEM SCHEDULE NAME", "itemScheduleName"],
  ["RM ITEM CODE", "rmItemCode", "upsert key part; blank rows skipped"],
  ["RM ITEM NAME", "rmItemName"],
  ["BOM ID TYPE", "bomIdType", "2:1 / 3:1 / DIRECT M2M / CREATE BOM"],
  ["BOM ITEM QTY", "bomItemQty"],
  ["STATUS OF BOM", "(filter)", '"closed" rows are skipped and left in the DB'],
);

/** The 18 VERIFY BOM columns the sync never touches. */
const VERIFY_BOM_UNREAD = cols(
  ["USE/NO USE", "noUse", "BOM MAST ERP TO_DATE flow"],
  ["AVAILABLE STOCK", "availableStock", "stock-phys + page-load recompute"],
  ["COST", "cost", "GMDUpdateItem.cost cascade"],
  ["BOM ITEM QTY * COST", "bomItemQtyCost", "derived on page load"],
  ["ITEM TYPE", "itemType", "GMD Item Creation Form"],
  ["MOC", "moc", "GMD Item Creation Form"],
  ["OPERATION", "operation", "GMD Item Creation Form"],
  ["SIZE", "size", "GMD Item Creation Form"],
  ["NO", "no", "GMD Item Creation Form"],
  ["PN-GMD", "pnGmd", "GMD Item Creation Form"],
  ["CURRENT REQT", "currentReqt", "GMD Item Creation Form"],
  ["NEW ITEM NAME", "merged", "derived on page load — overwrites MERGED"],
  ["DUPLICATE MERGER COUNT", "duplicateMergerCount", "GMD Item Creation Form"],
  ["BOM NATURE", "bomNature", "GMD Item Creation Form"],
  ["CONSUMPTION-1", "consumption1", "GMD Item Creation Form"],
  ["CONSUMPTION 2", "consumption2", "GMD Item Creation Form"],
  ["CONSUMPTION 3", "consumption3", "GMD Item Creation Form"],
  ["C BATCH", "cBatch", "BOM MAST ERP TO_DATE flow"],
);

/** GMD Item Creation Form -> VerifyBom metadata fan-out. */
const BOM_META_COLUMNS = cols(
  ["CODE FOR THE ITEM", "(join key)", "matched against VerifyBom.itemCode"],
  ["ITEM TYPE", "itemType"],
  ["MOC", "moc"],
  ["OPERATION", "operation"],
  ["SIZE", "size"],
  ["NO", "no"],
  ["PN-GMD", "pnGmd"],
  ["CURRENT REQT", "currentReqt"],
  ["MERGED", "merged", "sheet header differs from the UI's NEW ITEM NAME"],
  ["DUPLICATE MERGER COUNT", "duplicateMergerCount"],
  ["BOM NATURE", "bomNature"],
  ["CONSUMPTION-1", "consumption1"],
  ["CONSUMPTION 2", "consumption2"],
  ["CONSUMPTION 3", "consumption3"],
);

/** stock-phys — shared by 4 write paths across 3 pages. */
const STOCK_PHYS_COLUMNS = cols(
  ["ERP CODE", "(join key)", "trimmed + upper-cased"],
  ["SUM OF PHYSICAL STOCK", "availableStock", 'trailing dots stripped; "0" is kept'],
);

/** BOM MAST ERP -> VerifyBom TO_DATE flow. */
const BOM_MAST_COLUMNS = cols(
  ["BOM_ID", "bomId", "key part"],
  ["ITEM_CODE", "itemCode", "key part"],
  ["RM_ITEM_CODE", "rmItemCode", "key part"],
  ["TO_DATE", "noUse + cBatch", 'non-blank => noUse="NO USE" AND cBatch="C"'],
);

/** ITEM MASTER ERP — two independent consumers. */
const ITEM_MASTER_COLUMNS = cols(
  ["ITEM_CODE", "(join key)", "trimmed + upper-cased"],
  ["ITEM_NAME", "itemName / rmItemName", "itemCode -> itemName, rmItemCode -> rmItemName"],
  ["ITEM_STATUS", "cBatch", '= "C" marks batch C; 4279 of 22252 codes'],
);

/** CONTRACT DUMP -> ContractReview one-time seed (28 of 32 headers map). */
const CONTRACT_DUMP_SEED_COLUMNS = cols(
  ["CONTRACT NO", "contractNo", "join key"],
  ["ITEM_CODE", "itemCode", "join key"],
  ["CONTRACT DATE", "dateOfContract", "alias — normalises to DATE OF CONTRACT"],
  ["PARTY NAME", "partyNameDump"],
  ["MC NO", "mcNo"],
  ["PO NO", "poNo"],
  ["ITEM_NAME", "itemName"],
  ["PARTY ITEM NAME", "partyItemName"],
  ["RATE", "rate", "numeric guard: -1,234 / (123) / 12.5 accepted"],
  ["VALUE", "value"],
  ["CV", "cv"],
  ["VA %", "vaPercent"],
  ["ORDER QTY", "orderQty"],
  ["FREE STOCK", "freeStock"],
  ["FINAL REQ", "finalReq"],
  ["MC QTY", "mcQty"],
  ["Balance mc", "balanceMc"],
  ["PROD ORD QTY", "prodOrdQty"],
  ["BALANCE TO PROD ORD", "balanceToProdOrd"],
  ["BALANCE TO PROD ENT", "balanceToProdEnt"],
  ["DI QTY", "diQty"],
  ["BILLED QTY", "billedQty"],
  ["BAL BILL AG MC", "balBillAgMc"],
  ["BAL BILL AG CONT", "balBillAgCont"],
  ["BAL DI QTY", "balDiQty"],
  ["BAL MC VAL", "balMcVal"],
  ["BAL BILL AG CONT VAL", "balBillAgContVal"],
  ["BAL DI VAL", "balDiVal"],
  ["Item", "item"],
  ["SIZE", "size"],
  ["CLEARANCE STATUS", "clearanceStatus"],
  ["PAYMENT TERMS", "paymentTerms"],
  ["PROD ORDER NO", "productionOrderNumber"],
  ["#N/A / #REF! / #VALUE!", "(rejected)", "17,703 formula errors — treated as blank"],
);

/** Sale Bill -> SupplyHistoryItem (optional script). */
const SALE_BILL_COLUMNS = cols(
  ["FY", "financialYear"],
  ["SALE_BILL_NUMBER", "invoiceNo", "upsert key part 1"],
  ["SALE_BILL_DATE", "date", "formatted to DD-Mmm-YY"],
  ["ITEM_CODE", "erpItemCode"],
  ["ITEM_NAME", "itemName", "upsert key part 2"],
  ["LRNO", "lrNoDt"],
  ["PARTYREFNO", "partyOrderNo"],
  ["PARTYREFDATE", "partyDate"],
  ["CONTRACT_VRNO", "erpContractNo"],
  ["INVOICE_QTY", "quantity"],
  ["RATE", "value", "value = RATE x INVOICE_QTY"],
  ["INVOICE_AMT", "grossTotalInvoiceValue"],
  ["ACC_NAME", "partyName"],
  ["TRUCKNO", "(dropped)", "read but not stored"],
  ["ITEM_SCH", "(dropped)", "read but not stored"],
  ["TRPT_CODE", "(dropped)", "read but not stored"],
  ["ACC_CODE", "(dropped)", "read but not stored"],
);

/* ------------------------------------------------------------------ *
 * GMD Item Creation Form (gid 2142407502) — three separate consumers
 * ------------------------------------------------------------------ */

/** -> GmdItemCode. The 6 columns syncGmdItemCodes requires; all must be present. */
const GMD_ITEM_FORM_ITEMCODE = cols(
  ["CODE FOR THE ITEM", "itemCode", "the composite key"],
  ["ITEM TYPE", "itemType", "findIndex — first occurrence"],
  ["MOC", "moc"],
  ["OPERATION", "operation", "stands in for the app's operationType"],
  ["SIZE", "size"],
  ["PN-GMD", "pnGmd", "stands in for the app's pnRating"],
);

/** -> EnquiryItem. DIRECT M2M recipe. ITEM TYPE is matched with lastIndexOf here. */
const GMD_ITEM_FORM_BOM = cols(
  ["CODE FOR THE ITEM", "(join key)"],
  ["ITEM TYPE", "(filter)", 'lastIndexOf; = "DIRECT M2M"'],
  ["BOM ID", "bomId", "findIndex — first occurrence"],
  ["CONSUMPTION-1", "rmItemCode", "the raw-material code"],
);

/** -> EnquiryItem. 2:1 recipe: every CONSUMPTION* column, not just -1. */
const GMD_ITEM_FORM_2TO1 = cols(
  ["CODE FOR THE ITEM", "(join key)"],
  ["ITEM TYPE", "(filter)", 'lastIndexOf; = "2:1"'],
  ["BOM ID", "bomId", "must be non-empty and not '-'"],
  ["CONSUMPTION-1 … CONSUMPTION-n", "cost inputs", "all CONSUMPTION* headers; codes starting with F are excluded"],
);

/** The 5 derived fields the item-code lookup is a composite of. */
const QUOTATION_DERIVED_FIELDS = cols(
  ["(app field) itemType", "itemType", "1 of the 5 lookup inputs"],
  ["(app field) moc", "moc", "2 of 5"],
  ["(app field) operationType", "operation", "3 of 5, from the sheet's OPERATION"],
  ["(app field) size", "size", "4 of 5"],
  ["(app field) pnRating", "pnGmd", "5 of 5, from the sheet's PN-GMD"],
);

/** -> EnquiryItem. The nine columns recalculateItem recomputes on every write. */
const QUOTATION_CALC_COLUMNS = cols(
  ["(input) productCost", "productCost"],
  ["(input) extension", "extension", "flat cost from ExtensionCost"],
  ["(input) bypass", "bypass", "flat cost from BypassCost"],
  ["(enquiry) paymentTerms", "cost multiplier", "PaymentTermsCost.costPct"],
  ["(enquiry) inspection", "cost multiplier", "InspectionCost.costPct"],
  ["(enquiry) pbg", "cost multiplier", "PbgCost.costPct"],
  ["(enquiry) state", "cost multiplier", "TransportationCost; full load at productCost >= 50,00,000"],
  ["(derived)", "cost", "productCost x 1.08 + flats + productCost x 1.08 x pctSum"],
  ["(derived)", "vaPercent", "((quotedRate / cost) - 1) x 100, or the anchor when rate is set"],
  ["(derived)", "quotedRate", "roundUp(cost x (1 + vaPercent / 100))"],
  ["(derived)", "quotedRateGst", "quotedRate x 1.18"],
  ["(derived)", "itemWiseTotalValue", "quantity x quotedRate"],
  ["(derived)", "totalValue", "itemWiseTotalValue x 1.18"],
  ["(derived)", "itemNameMerge", "itemType-moc-size-pnRating-operationType-extension-bypass[-WITH-others]"],
);

/** -> LookupOption. Seeded by scripts/seed-lookup-options.ts; every dropdown on / comes from these. */
const LOOKUP_OPTION_TYPES = cols(
  ["(no sheet column)", "LookupOption.type", "PARTY, UTILITY, ITEM_TYPE, MOC, SIZE, PN_RATING, ENQUIRY_TYPE, STATE, PAYMENT_TERM, INSPECTION, PBG, ORDER_STATUS, CLOSURE_STATUS, OPERATION_TYPE, EXTENSION, BYPASS, OTHERS, DELIVERY"],
  ["(no sheet column)", "LookupOption.value", "one row per option, sortOrder drives display order"],
);

/** -> the six flat/percentage cost tables the cost engine reads. */
const COST_TABLE_SEEDS = cols(
  ["(no sheet column)", "ExtensionCost", "seed-extension-costs.ts — flat cost per extension"],
  ["(no sheet column)", "BypassCost", "seed-bypass-costs.ts — flat cost per bypass"],
  ["(no sheet column)", "PaymentTermsCost", "seed-payment-terms-costs.ts — costPct"],
  ["(no sheet column)", "InspectionCost", "seed-inspection-costs.ts — costPct"],
  ["(no sheet column)", "PbgCost", "seed-pbg-costs.ts — costPct"],
  ["(no sheet column)", "TransportationCost", "seed-transportation-costs.ts — partLoad / fullLoad, full load applies at productCost >= 50,00,000"],
);

/** -> EnquiryItem. The derived-field normalisation family of scripts. */
const QUOTATION_CLEANUP_COLUMNS = cols(
  ["itemName", "itemType / moc / size / pnRating / operationType / extension / bypass", "re-derived by keyword then AI"],
  ["moc", "moc", "normalised against the MOC dropdown"],
  ["size", "size", "normalised against the SIZE dropdown"],
  ["itemType", "itemType", "normalised against the ITEM_TYPE dropdown"],
  ["bypass", "bypass", 'orphans reset to "-" and cost recalculated'],
  ["rmType", "rmType", "normalised to COMMON"],
  ["importedInhouse", "importedInhouse", "derived from itemType + size"],
  ["deliverySchedule", "deliverySchedule", "derived from quantity + stock + size"],
  ["itemNameMerge", "itemNameMerge", "adds the -WITH-<others> suffix"],
);

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

const RAW_MATERIAL_SYNC: SyncOperation[] = [
  {
    id: "rm-grid-read",
    name: "Raw Material grid read",
    kind: "lookup",
    file: "app/raw_material/api/gmd-update/route.ts",
    line: "10-74",
    purpose:
      "Returns the GMDUpdateItem table as a header/row grid for the page, plus the per-row BOM-ID dropdown options derived from VerifyBom.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    dbModels: ["GMDUpdateItem", "VerifyBom"],
    writePolicy:
      "Pure read — no writes. Emits 31 headers / 31 cells by inserting ITEM NAME (derived) at position 2 and appending C BATCH.",
    cadence: "every-page-load",
  },
  {
    id: "rm-gmd-updation-sync",
    name: "GMD UPDATION sync",
    kind: "sync",
    file: "app/raw_material/api/gmd-update/sync/route.ts",
    line: "70-243",
    purpose:
      "The main Raw Material sync: pulls the item catalogue from GMD UPDATION, overlays physical stock, and diffs it into GMDUpdateItem.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync button",
    sheetTab: "GMD UPDATION",
    sheetRange: "'GMD UPDATION'!A:ZZZ",
    headerRow: 1,
    columns: GMD_UPDATION_COLUMNS,
    dbModels: ["GMDUpdateItem"],
    writePolicy:
      "Creates new ERP codes; on existing codes overwrites only the 12 NON_EDITABLE_FIELDS (itemNameAuto, L1-L8, um, conv2, currentStatus). The other 13 are user-owned and never touched. Rows whose NEW ITEM STATUS is CLOSED / TO BE CLOSED / TO BE LOCKED are dropped entirely. No deletes, no write-back to the sheet.",
    cadence: "every-sync",
  },
  {
    id: "rm-stock-phys-overlay",
    name: "stock-phys overlay inside the sync",
    kind: "sync",
    file: "lib/gmd_lib/google-sheets.ts:fetchStockPhysicalSheet",
    line: "163-206",
    purpose:
      "Overlays the physical stock count onto the catalogue before the diff, so Available Stock reflects the stock-phys tab rather than GMD UPDATION.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync button (step 2)",
    sheetTab: "stock-phys",
    sheetRange: "'stock-phys'!A:ZZZ",
    headerRow: 2,
    columns: STOCK_PHYS_COLUMNS,
    dbModels: ["GMDUpdateItem"],
    writePolicy:
      "Sets row index 11 (Available Stock) on the in-memory row, so the physical value wins over the sheet's own. Then the field becomes user-editable, i.e. later syncs leave it alone.",
    cadence: "every-sync",
    sharedWith:
      "BOM (Sync Missing Stock), Contract Review (Sync RM AVAIL), scripts/sync-available-stock-from-stock-phys.ts",
  },
  {
    id: "rm-derived-item-name",
    name: "Derived item name",
    kind: "derived",
    file: "app/actions.ts:updateDerivedItemName",
    line: "3064-3115",
    purpose:
      "Builds ITEM NAME (derived) from the L-level columns so the page has a readable name the sheet does not carry.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Fired inside the sync for every created/changed code",
    dbModels: ["GMDUpdateItem"],
    writePolicy:
      "Only ever writes itemNameDerived. GEAR BOX => L4-L5-L7; otherwise L8-L2-L3-L4-L5-L6-L7 joined with '-'. TRADING VALVE(S) => TV. Dedupe ignores a trailing S.",
    cadence: "every-sync",
  },
  {
    id: "rm-category-lookup",
    name: "GMD Category dropdown lookup",
    kind: "lookup",
    file: "app/raw_material/api/gmd-category/route.ts + lib/gmd_lib/google-sheets.ts:fetchGMDCategorySheet",
    line: "route 1-11 / google-sheets 126-161",
    purpose:
      "Turns every column of the GMD Category tab into a distinct-value list, which becomes the option set for all Raw Material dropdown cells.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    sheetTab: "GMD Category",
    sheetRange: "'GMD Category'!A:ZZZ",
    headerRow: 1,
    dbModels: [],
    writePolicy:
      "Read-only and never persisted. Generic — every header becomes a key in the returned map. Silently returns {} if the tab is missing.",
    cadence: "every-page-load",
  },
  {
    id: "rm-cell-edits",
    name: "Inline cell edits",
    kind: "edit",
    file: "app/actions.ts (Redux thunks in lib/gmdUpdateSlice.ts)",
    line: "2253-3193",
    purpose:
      "Every manual edit on the Raw Material grid: cell blur, dropdown change, Yes-No toggle, Paste-ERP, Excel import, and the Match & Update Costs dialog.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit / paste / import / dialog",
    dbModels: ["GMDUpdateItem", "LookupOption"],
    columns: cols(
      ["CONV", "conv1"],
      ["AUM", "aum"],
      ["1 pcs wgt", "pcsWgt"],
      ["cost", "cost"],
      ["Available Stock", "availableStock"],
      ["INDIAN/IMPORTED", "indianImported"],
      ["USD cost", "usdRateOption", "also recomputes cost = usd x rate"],
      ["HSN CODE", "hsnCode"],
      ["HSN Code Validation", "hsnCodeValidation"],
      ["MAJOR MARKING", "majorMarking"],
      ["RM TYPE", "rmType"],
      ["NEW ITEM STATUS", "newItemStatus"],
      ["Order Qty", "orderDelivery"],
      ["BOM ID", "bomId", "validated against distinct VerifyBom.bomId"],
      ["Vendor Reference", "vendorReference"],
      ["Attachment", "attachmentUrl", "PDF/PNG/JPEG/WEBP, 10 MB, stored in S3"],
      ["(not a column)", "transferred", "Paste-ERP + Transferred table"],
      ["ITEM NAME (derived)", "itemNameDerived"],
      ["(not a column)", "cBatch"],
    ),
    writePolicy:
      "UPDATE-ALL-EXCEPT on a per-row basis. updateGMDUpdateFieldAction has no field allow-list — it spreads { [field]: value } straight into prisma.rawMaterial.update, so any column name sent by the client is writable. applyTransferCostMatchAction additionally CLEARS L1-L8 on the source row.",
    cadence: "on-demand",
  },
  {
    id: "rm-casting-rates",
    name: "GMD casting rates",
    kind: "edit",
    file: "app/actions.ts:saveGMDCastingRateAction",
    line: "5290-5330",
    purpose:
      "Stores the per-material casting rate (DI / CS / CI / SS / Bronze) that the grid uses to compute casting costs locally.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "600 ms debounce on the Cast Rates inputs",
    dbModels: ["LookupOption"],
    writePolicy:
      "Upserts LookupOption rows with type = GMD_CASTING_RATE and value shaped 'KEY=rate'.",
    cadence: "on-demand",
  },
  {
    id: "rm-usd-rate",
    name: "USD/INR rate lookup",
    kind: "lookup",
    file: "app/actions.ts:getUsdInrRateAction + lib/gmd_lib/exchangeRate.ts",
    line: "3117-3126 / 10-35",
    purpose:
      "Fetches the live USD/INR rate used to convert USD cost into the local cost column.",
    direction: "external-api",
    trigger: "page-load",
    triggerLabel: "Page load, plus the refresh link in the table toolbar",
    dbModels: [],
    writePolicy:
      "No DB writes. open.er-api.com with api.frankfurter.app as fallback; cached 6 hours in-process.",
    cadence: "every-page-load",
  },
  {
    id: "rm-trading-valve-cascade",
    name: "Trading valve cascade options",
    kind: "lookup",
    file: "app/actions.ts:getTradingValveOptionsAction",
    line: "2891-2907",
    purpose:
      "Collects the L1-L8 combinations already used by TRADING VALVE items so the dependent dropdowns cascade.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    dbModels: ["GMDUpdateItem"],
    writePolicy: "Pure read. Filters l8ItemCategory contains 'TRADING VALVE'.",
    cadence: "every-page-load",
  },
  {
    id: "rm-non-chain-bom-metadata",
    name: "NON CHAIN BOM / MRP-IS presence check",
    kind: "diagnostic",
    file: "lib/gmd_lib/google-sheets.ts:fetchSheetMetadata",
    line: "44-87",
    purpose:
      "Was intended to verify that the NON CHAIN BOM and MRP/IS tabs exist and report their row counts.",
    direction: "read-only",
    trigger: "none",
    triggerLabel: "No caller",
    sheetTab: "NON CHAIN BOM, MRP/IS",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    dbModels: [],
    writePolicy:
      "Nothing is written and nothing is read beyond counting rows. There are zero call sites in the repo, so this never runs.",
    cadence: "manual",
    dead: true,
  },
  {
    id: "rm-script-stock",
    name: "stock-phys -> GMDUpdateItem",
    kind: "script",
    file: "scripts/sync-available-stock-from-stock-phys.ts",
    line: "22-109",
    purpose:
      "Standalone version of the in-sync stock overlay, for re-running just the Available Stock column.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run stock:sync -- --apply",
    sheetTab: "stock-phys",
    sheetRange: "'stock-phys'!A:ZZZ",
    headerRow: 2,
    columns: STOCK_PHYS_COLUMNS,
    dbModels: ["GMDUpdateItem"],
    writePolicy:
      "Only availableStock, keyed on erpItemCode. Dry-run unless --apply. This is the one script that CAN overwrite an existing stock value.",
    cadence: "manual",
    npmCommand: "npm run stock:sync",
    dryRunDefault: true,
  },
  {
    id: "rm-script-derived-name",
    name: "Backfill derived item name",
    kind: "script",
    file: "scripts/populate-derived-item-name.ts",
    line: "1-108",
    purpose:
      "Recomputes ITEM NAME (derived) for every row, using the same algorithm as the sync.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/populate-derived-item-name.ts --dry-run",
    dbModels: ["GMDUpdateItem"],
    writePolicy: "Only itemNameDerived, in batches of 200. Dry-run unless --dry-run is absent.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/populate-derived-item-name.ts",
    dryRunDefault: true,
  },
  {
    id: "rm-script-cost-readers",
    name: "GMDUpdateItem.cost as the cost source",
    kind: "lookup",
    file: "scripts/backfill-verify-bom-cost.ts, backfill-m2m-available-stock.ts, dry-run-2to1-cost.ts, update-2to1-cost-from-bom.ts",
    line: "—",
    purpose:
      "Four scripts consume Raw Material as their input rather than writing to it: they read cost / availableStock / rmType / bomId to price BOMs and M2M items.",
    direction: "read-only",
    trigger: "manual-script",
    triggerLabel: "npm run bom:cost:derive, npx tsx scripts/update-2to1-cost-from-bom.ts",
    dbModels: ["GMDUpdateItem", "VerifyBom", "EnquiryItem"],
    columns: cols(
      ["ERP ITEM CODE", "erpItemCode", "join key"],
      ["cost", "cost", "wins over the SupplyHistory fallback"],
      ["Available Stock", "availableStock"],
      ["RM TYPE", "rmType"],
      ["BOM ID", "bomId"],
    ),
    writePolicy:
      "GMDUpdateItem is read-only here. Cost precedence: Raw Material cost first, SupplyHistory value/quantity second.",
    cadence: "manual",
    npmCommand: "npm run bom:cost:derive",
    dryRunDefault: true,
  },
  {
    id: "rm-cbatch",
    name: "Batch C mark",
    kind: "sync",
    file: "app/actions.ts:syncCBatchAction",
    line: "4942-5121",
    purpose:
      "Marks cBatch = 'C' on every Raw Material row whose ERP code has ITEM_STATUS = 'C', surfaced as a chip inside the ERP ITEM CODE cell.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync C Batch button (on /data-sources)",
    sheetTab: "ITEM MASTER ERP",
    sheetGid: "253020709",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: ITEM_MASTER_COLUMNS,
    dbModels: ["GMDUpdateItem"],
    writePolicy:
      "Set-only on GMDUpdateItem — an existing mark is never cleared. Chunked at 1000. /bom is deliberately excluded because its cBatch comes from the BOM MAST TO_DATE flow.",
    cadence: "every-sync",
    sharedWith:
      "Contract Review, Supply History, Quotation — all four tables are handled in the same action",
  },
];

const SUPPLY_HISTORY_SYNC: SyncOperation[] = [
  {
    id: "sh-grid-read",
    name: "Supply History grid read",
    kind: "lookup",
    file: "app/api/supply-history/route.ts",
    line: "53-110",
    purpose:
      "Returns the whole SupplyHistoryItem table as a 39-column display grid, plus the UTILITY dropdown options.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    dbModels: ["SupplyHistoryItem", "LookupOption"],
    writePolicy:
      "Pure read. Merges sheet value over derived value for Item Type / MOC / Size. The whole table is returned with no server-side pagination.",
    cadence: "every-page-load",
  },
  {
    id: "sh-master-sync",
    name: "MASTER sync",
    kind: "sync",
    file: "app/api/supply-history/sync/route.ts",
    line: "17-332",
    purpose:
      "The main Supply History sync: pulls supply/invoice rows from MASTER and diffs them into SupplyHistoryItem.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync button",
    sheetTab: "MASTER",
    sheetRange: "'MASTER'!A:ZZZ",
    headerRow: 1,
    columns: [...SUPPLY_MASTER_COLUMNS, ...SUPPLY_MASTER_UNREAD],
    dbModels: ["SupplyHistoryItem"],
    writePolicy:
      "Join key = INVOICE NO + item name (both trimmed/upper-cased), matched against the @@unique index. 6 EDITABLE_FIELDS are gap-fill only (partyMailAddress, derivedItemType/Moc/Size, state, utility); every other field overwrites when it differs. A blank sheet cell never clears a DB value. No deletes.",
    cadence: "every-sync",
  },
  {
    id: "sh-order-list",
    name: "ORDER LIST enrichment",
    kind: "sync",
    file: "lib/gmd_lib/contract-order-links.ts:buildGmdClientwiseOrderLinkMap",
    line: "137-238",
    purpose:
      "Resolves each row's PARTY Order No. into PO attachment URLs, so the ORDER LIST column carries clickable order copies.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync button (step 3)",
    sheetTab: "CONTRACTS COPY",
    sheetGid: "422553416",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: cols(
      ["PO NO", "(join key)", "trimmed + upper-cased; DT suffix stripped as a 2nd attempt"],
      ["ATTACH* (any header containing ATTACH)", "orderList", "comma-split, deduped, comma-joined"],
    ),
    dbModels: ["SupplyHistoryItem"],
    writePolicy:
      "Append-only union: the incoming link set is merged into the existing comma CSV and only written when the link count grows. Runs a second pass with includeGridData to recover hyperlinks that FORMATTED_VALUE hides behind chip text.",
    cadence: "every-sync",
  },
  {
    id: "sh-order-link-dead",
    name: "Contract Sheet ORDER LINK helper",
    kind: "lookup",
    file: "lib/gmd_lib/contract-order-links.ts:buildContractOrderLinkMap",
    line: "80-135",
    purpose:
      "Earlier PO-to-attachment resolver, kept for reference after the source moved to GMD Clientwise.",
    direction: "read-only",
    trigger: "none",
    triggerLabel: "No caller",
    sheetTab: "ORDER LINK helper",
    sheetGid: "1367392830",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: cols(
      ["PO NO", "(join key)"],
      ["ATTACH* (any header containing ATTACH)", "orderList"],
    ),
    dbModels: [],
    writePolicy:
      "Zero call sites. The sync route imports only buildGmdClientwiseOrderLinkMap.",
    cadence: "manual",
    dead: true,
  },
  {
    id: "sh-cell-edits",
    name: "Inline cell edits",
    kind: "edit",
    file: "app/actions.ts:updateSupplyHistoryFieldAction",
    line: "5249-5260",
    purpose:
      "Saves the six fields the page allows editing. Any other header is silently ignored.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit",
    dbModels: ["SupplyHistoryItem"],
    columns: cols(
      ["Party Mail Address", "partyMailAddress"],
      ["State", "state"],
      ["UTILITY", "utility", "options from LookupOption type=UTILITY"],
      ["Item Type", "derivedItemType"],
      ["MOC", "derivedMoc"],
      ["Size", "derivedSize"],
    ),
    writePolicy:
      "Whitelisted by SUPPLY_HEADER_TO_DB_FIELD. Blank input is written as null, so clearing a cell does clear it here — unlike the sync.",
    cadence: "on-demand",
  },
  {
    id: "sh-rm-cost-reader",
    name: "Supply History as the RM cost fallback",
    kind: "lookup",
    file: "lib/gmdBomCostLookup.ts:buildRmCostMap",
    line: "158-205",
    purpose:
      "Computes a raw-material unit cost from supply rows, used whenever Raw Material has no cost for the code.",
    direction: "read-only",
    trigger: "button",
    triggerLabel: "Fired inside the costing engine on the Quotation page",
    dbModels: ["SupplyHistoryItem"],
    columns: cols(
      ["ERP ITEM CODE", "erpItemCode", "matched against the BOM's rmItemCode"],
      ["Quantity", "quantity", "divisor"],
      ["Value", "value", "dividend; commas stripped"],
      ["Date", "date", "DD-Mmm-YY; the latest row wins"],
    ),
    writePolicy:
      "Read-only. unitCost = value / quantity on the newest row; ties break toward the higher cost. Always the fallback behind GMDUpdateItem.cost.",
    cadence: "on-demand",
  },
  {
    id: "sh-order-list-publish",
    name: "ORDER LIST -> Contract Review",
    kind: "backfill",
    file: "app/actions.ts:backfillContractReviewOrderListBatchAction",
    line: "3506-3560",
    purpose:
      "Copies the ORDER LIST links from Supply History onto Contract Review rows, matched by erpItemCode.",
    direction: "db-to-db",
    trigger: "none",
    triggerLabel: "Call site on /contract_review is commented out (page.tsx:1126-1144)",
    dbModels: ["SupplyHistoryItem", "ContractReview"],
    writePolicy:
      "Writes ContractReview.orderList from SupplyHistoryItem.orderList by erpItemCode. Currently unreachable from the UI, so orderList only arrives via scripts/sync-contract-po.ts.",
    cadence: "manual",
    dead: true,
  },
  {
    id: "sh-script-derive",
    name: "Derive Item Type / MOC / Size",
    kind: "script",
    file: "scripts/derive-supply-fields.ts",
    line: "18-78",
    purpose:
      "Fills the three derived columns from the item name, first by keyword rules then by AI for whatever the keyword pass misses.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/derive-supply-fields.ts",
    dbModels: ["SupplyHistoryItem"],
    columns: cols(
      ["item name", "itemName", "the input"],
      ["TYPE OF VALVE", "derivedItemType", "sheet value wins over the derived one"],
      ["MOC", "derivedMoc", "sheet value wins"],
      ["SIZE OF VALVE", "derivedSize", "sheet value wins"],
    ),
    writePolicy:
      "UNCONDITIONAL overwrite of derivedItemType / derivedMoc / derivedSize, unlike the sync's gap-fill rule. Writes only when all three resolve. AI phase runs at concurrency 20 on gpt-4o-mini.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/derive-supply-fields.ts",
  },
  {
    id: "sh-script-states",
    name: "Backfill State from address",
    kind: "script",
    file: "scripts/backfill-supply-states.ts",
    line: "40-207",
    purpose:
      "Derives the Indian state for rows that have none, from the consignee address.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/backfill-supply-states.ts --dry-run",
    dbModels: ["SupplyHistoryItem"],
    columns: cols(
      ["CONSIGNEE ADDRESS", "state", "the input"],
      ["CONSIGNEE NAME", "(context)"],
      ["party name", "(context)"],
      ["DELIVERY DESTINATION", "(context)"],
    ),
    writePolicy:
      "Only state, only on rows that are blank. Regex first, then gpt-4o-mini against a 36-state allow-list. Skipped when OPENAI_API_KEY is missing or AI_VALIDATION_ENABLED=false.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/backfill-supply-states.ts",
    dryRunDefault: true,
  },
  {
    id: "sh-script-sale-bill",
    name: "Sale Bill import",
    kind: "script",
    file: "scripts/import-sale-bill.ts",
    line: "7-162",
    purpose:
      "Optional second source of supply rows: upserts the Sale Bill sheet into the same model.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/import-sale-bill.ts",
    sheetTab: "GID 0",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: SALE_BILL_COLUMNS,
    dbModels: ["SupplyHistoryItem"],
    writePolicy:
      "upsert on (invoiceNo, itemName). Unlike the MASTER sync this is a full overwrite of the 12 mapped fields, so it will replace values the sync gap-filled. No dry-run flag — it always writes.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/import-sale-bill.ts",
  },
  {
    id: "sh-cbatch",
    name: "Batch C mark",
    kind: "sync",
    file: "app/actions.ts:syncCBatchAction",
    line: "5036-5066",
    purpose:
      "Marks cBatch = 'C' on every Supply History row whose ERP ITEM CODE has ITEM_STATUS = 'C'.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync C Batch button (on /data-sources)",
    sheetTab: "ITEM MASTER ERP",
    sheetGid: "253020709",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: ITEM_MASTER_COLUMNS,
    dbModels: ["SupplyHistoryItem"],
    writePolicy:
      "Set-only on erpItemCode, chunked at 1000. Never clears. The MASTER sync itself never touches cBatch.",
    cadence: "every-sync",
  },
];

const CONTRACT_REVIEW_SYNC: SyncOperation[] = [
  {
    id: "cr-grid-read",
    name: "Contract Review grid read",
    kind: "lookup",
    file: "app/api/contract-review/route.ts",
    line: "14-105",
    purpose:
      "Returns all 70 ContractReview columns as a grid, plus the BOM-ID dropdown options, per-item images and diagram verdicts.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    dbModels: ["ContractReview", "Bom", "BomItem", "EnquiryItem", "GeneratedImage"],
    writePolicy:
      "NOT a pure read: it persists ContractReview.noUse whenever the computed RM AVAIL differs. Orders by syncedAt desc.",
    cadence: "every-page-load",
  },
  {
    id: "cr-sheet-sync",
    name: "CONTRACTS + DUMP sync",
    kind: "sync",
    file: "app/api/contract-review/sync/route.ts",
    line: "20-263",
    purpose:
      "The main Contract Review sync: joins the CONTRACTS tab against the DUMP tab and diffs the result into ContractReview.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync Contract Review button (sidebar) -> POST /api/contract-review/sync",
    sheetTab: "CONTRACTS + DUMP",
    sheetGid: "734728893 (CONTRACTS), 1604813523 (DUMP)",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 4,
    columns: [...CONTRACTS_COLUMNS, ...DUMP_COLUMNS],
    dbModels: ["ContractReview", "Bom", "BomItem", "Enquiry"],
    writePolicy:
      "Join key = ITEM_CODE + CONTRACT NO. ContractReview has NO @@unique on that pair (dropped in 20260905063935), so findFirst is non-deterministic when duplicates exist. 11 PRESERVE_UI_FIELDS are gap-fill only, 5 SKIP_FIELDS are never written, everything else overwrites when it differs. Blank sheet never clears. No deletes — row counts only grow.",
    cadence: "every-sync",
  },
  {
    id: "cr-post-sync-rmavail",
    name: "Post-sync RM AVAIL recompute",
    kind: "derived",
    file: "lib/verifyBomLookup.ts:computeContractReviewRmAvail",
    line: "399-431",
    purpose:
      "Allocates raw-material stock across contracts and writes the RM AVAIL result, so each row shows SA or Not available.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync button (side effect 2 of 4)",
    dbModels: ["ContractReview", "Bom", "BomItem"],
    writePolicy:
      "Writes only ContractReview.noUse, only for rows that already have a bomId. Allocation starts from the lowest ORDER QTY.",
    cadence: "every-sync",
  },
  {
    id: "cr-post-sync-enquiry",
    name: "Post-sync Enquiry field backfill",
    kind: "backfill",
    file: "lib/gmd_lib/contract-review-enquiry-backfill.ts:applyContractReviewEnquiryBackfill",
    line: "31-136",
    purpose:
      "Copies state / utility / project reference from the enquiry that owns the contract.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync button (side effect 3 of 4)",
    dbModels: ["ContractReview", "Enquiry"],
    columns: cols(
      ["(Enquiry) state", "state"],
      ["(Enquiry) utility", "utility"],
      ["(Enquiry) projectReference", "projectReference"],
    ),
    writePolicy:
      "FULL 3-field replace, matched on Enquiry.selectedContractNo with the newest enquiryDate winning. UNMATCHED rows are cleared to null — this is the one path that can blank those columns.",
    cadence: "every-sync",
  },
  {
    id: "cr-post-sync-contractno",
    name: "Post-sync Enquiry contract numbers",
    kind: "backfill",
    file: "lib/syncEnquiryContractNumbers.ts",
    line: "19-57",
    purpose:
      "Pushes the contract numbers belonging to each party onto Enquiry.contractNo, so enquiries know which contracts they carry.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync button (side effect 4 of 4)",
    dbModels: ["Enquiry", "ContractReview"],
    columns: cols(
      ["(ContractReview) PARTY NAME", "partyName", "grouping key"],
      ["(ContractReview) CONTRACT NO", "contractNo[]", "the array that is written"],
    ),
    writePolicy:
      "Full String[] replace on Enquiry.contractNo, written as [] when no party matches.",
    cadence: "every-sync",
    sharedWith: "scripts/sync-contract-numbers.ts (npm run contract:sync)",
  },
  {
    id: "cr-pageload-bomid",
    name: "Page-load BOM ID auto-assign",
    kind: "derived",
    file: "app/actions.ts:selectContractReviewBomIdAction + autoAssignContractReviewBomIdFromActuator",
    line: "3195-3291",
    purpose:
      "Fills BOM ID without user input: whenever exactly one candidate BOM exists for the item code, or when the Actuator cell carries an L7@L6 pair.",
    direction: "db-to-db",
    trigger: "page-load",
    triggerLabel: "Page load (every visit)",
    dbModels: ["ContractReview", "Bom", "BomItem"],
    columns: cols(
      ["BOM ID", "bomId"],
      ["BOM ID TYPE", "itemType", "Bom.bomIdType, copied across"],
      ["RM AVAIL", "noUse", "recomputed after the assignment"],
    ),
    writePolicy:
      "Overwrites bomId / itemType / noUse on every qualifying row on every page load — not just when blank.",
    cadence: "every-page-load",
  },
  {
    id: "cr-pageload-nouse",
    name: "Page-load RM AVAIL refresh",
    kind: "derived",
    file: "app/actions.ts:backfillContractReviewNoUseBatchAction",
    line: "3293-3337",
    purpose: "Recomputes RM AVAIL for every row that has a BOM ID.",
    direction: "db-to-db",
    trigger: "page-load",
    triggerLabel: "Page load (every visit)",
    dbModels: ["ContractReview", "VerifyBom"],
    columns: cols(["RM AVAIL", "noUse"]),
    writePolicy: "Writes only noUse, on every row with a non-blank BOM ID.",
    cadence: "every-page-load",
  },
  {
    id: "cr-pageload-cost",
    name: "Page-load cost from quotation",
    kind: "derived",
    file: "app/actions.ts:backfillContractReviewCostFromQuotationAction",
    line: "3739-3790",
    purpose:
      "Pulls cost and VA% from the winning quotation for rows that have a contract number.",
    direction: "db-to-db",
    trigger: "page-load",
    triggerLabel: "Page load (every visit)",
    dbModels: ["ContractReview", "Enquiry", "EnquiryItem"],
    columns: cols(
      ["COST FROM QUOTATION", "costfromQuotation", "from EnquiryItem.cost"],
      ["VA % FROM COST", "vaPercentfromcost"],
    ),
    writePolicy: "Writes only the two cost columns, on rows with a non-blank CONTRACT NO.",
    cadence: "every-page-load",
  },
  {
    id: "cr-pageload-enquiry",
    name: "Page-load Enquiry field sync",
    kind: "backfill",
    file: "app/actions.ts:syncContractReviewEnquiryFieldsBatchAction",
    line: "3588-3587",
    purpose:
      "Runs the same state / utility / project-reference backfill as the post-sync side effect, on every page visit.",
    direction: "db-to-db",
    trigger: "page-load",
    triggerLabel: "Page load (every visit)",
    dbModels: ["ContractReview", "Enquiry"],
    columns: cols(
      ["STATE", "state"],
      ["UTILITY", "utility"],
      ["PROJECT REFERENCE", "projectReference"],
    ),
    writePolicy:
      "Applies to ALL rows and CAN CLEAR these three columns to null when no Enquiry matches.",
    cadence: "every-page-load",
  },
  {
    id: "cr-pageload-flags",
    name: "Page-load offer / inspection / PN flags",
    kind: "derived",
    file: "app/actions.ts:backfillContractReviewOfferPendingDoneBatchAction, backfillContractReviewInspectionBatchAction, backfillContractReviewPnRatingBatchAction",
    line: "3339-3504",
    purpose:
      "Derives the three dropdown flags and the PN rating without user input.",
    direction: "db-to-db",
    trigger: "page-load",
    triggerLabel: "Page load (every visit)",
    dbModels: ["ContractReview"],
    columns: cols(
      ["OFFER PENDING/DONE", "offerPendingDone", "DONE when itemCode + mcNo + offerNumber are all set"],
      ["Inspection", "inspection", "DONE when offerNumber + inspectionNumber are set"],
      ["PN RATING", "pnRating", "only written when the match is an existing dropdown value"],
    ),
    writePolicy:
      "Applies to ALL rows and overwrites unconditionally. PENDING is written where the inputs are missing.",
    cadence: "every-page-load",
  },
  {
    id: "cr-rm-avail-button",
    name: "Sync RM AVAIL button",
    kind: "backfill",
    file: "app/actions.ts:syncContractReviewRmAvailAction",
    line: "5122-5231",
    purpose:
      "Sidebar action that refreshes raw-material stock and republishes RM AVAIL and PHYSICAL STOCK on Contract Review.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync RM AVAIL (sidebar)",
    sheetTab: "stock-phys",
    sheetRange: "'stock-phys'!A:ZZZ",
    headerRow: 2,
    columns: [
      ...STOCK_PHYS_COLUMNS,
      { sheetHeader: "(derived)", dbField: "rmPhysicalStock", note: "resolved from costCodeRef" },
    ],
    dbModels: ["GMDUpdateItem", "Bom", "BomItem", "ContractReview"],
    writePolicy:
      "Gap-fills GMDUpdateItem.availableStock only where it is blank, then writes ContractReview.noUse and rmPhysicalStock.",
    cadence: "on-demand",
  },
  {
    id: "cr-cell-edits",
    name: "Inline cell edits and drawings",
    kind: "edit",
    file: "app/actions.ts",
    line: "2462-2545, 3873-3906",
    purpose:
      "Every manual edit on the grid plus the Upload Drawing / Clear / CORRECT-WRONG verdict controls.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit / dialog",
    dbModels: ["ContractReview"],
    columns: cols(
      ["DATE OF CONTRACT", "dateOfContract", "write-once — a non-blank cell cannot be changed"],
      ["Actuator", "actuator", "also derives RM CODE FOR ACTUATOR"],
      ["PROD ORDER NO", "productionOrderNumber", "must be exactly 11 characters"],
      ["Upload Drawing", "diagramUrl", "PDF only, stored in S3"],
      ["Upload Drawing", "diagramVerdict", "CORRECT / WRONG, requires an uploaded drawing"],
      ["bom formula trial", "bomFormulaTrial"],
      ["Item", "item"],
      ["CLEARANCE STATUS", "clearanceStatus"],
      ["MC Received/Pending", "mcReceivedPending"],
      ["Inspection", "inspection"],
      ["OFFER PENDING/DONE", "offerPendingDone"],
      ["PN RATING", "pnRating"],
      ["LC/RTGS REF NO", "lcRtgsRefNo"],
      ["LC DATE/RTGS DATE", "lcDateRtgsDate"],
      ["LAST DATE OF SHIPMENT/DATE OF LC", "lastDateOfShipmentDateOfLc"],
      ["Issuing bank name", "issuingBankName"],
      ["PAYMENT TERMS", "paymentTerms"],
      ["Remarks", "remarks"],
    ),
    writePolicy:
      "Mapped through CONTRACT_REVIEW_HEADER_TO_DB_FIELD. Only the 18 columns in the page's editableColumns list can be written.",
    cadence: "on-demand",
  },
  {
    id: "cr-cost-code-ref",
    name: "COST CODE REF publish",
    kind: "derived",
    file: "app/actions.ts:recomputeIndentListingVersionsAction",
    line: "4070-4188",
    purpose:
      "Resolves which RM codes the indent versions use and publishes the winning reference back onto the contract row.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Fired from the Indent Listing recompute",
    dbModels: ["IndentListing", "ContractReview", "GMDUpdateItem"],
    columns: cols(
      ["COST CODE REF", "costCodeRef", "the only column this path writes on ContractReview"],
    ),
    writePolicy:
      "Writes only costCodeRef. The main sync deliberately cannot reach this field, which is why it survives a sync.",
    cadence: "on-demand",
  },
  {
    id: "cr-script-ic-dump",
    name: "INSPECTION OFFER DUMP sync",
    kind: "sync",
    file: "scripts/sync-ic-dump.ts",
    line: "1-330",
    purpose:
      "Pulls inspection-clearance data from the INSPECTION OFFER DUMP tab into the three array columns that drive the MC / Inspection / DI states.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run ic:sync:apply",
    sheetTab: "INSPECTION OFFER DUMP",
    sheetGid: "148043829",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: IC_DUMP_COLUMNS,
    dbModels: ["ContractReview"],
    writePolicy:
      "Join key = MC No (col G) + Item Code (col C). Columns are positional (A/C/G/H/K) and asserted against their expected header names at startup. Each cell is comma-split and multiple sheet rows for one key are unioned. The three array columns are UNIONED into the DB — never shrunk, never cleared, normalized dedupe (case/whitespace-insensitive), existing order and casing preserved. Batched at 200.",
    cadence: "manual",
    npmCommand: "npm run ic:sync",
    dryRunDefault: true,
  },
  {
    id: "cr-script-diagram",
    name: "Drawing hyperlink sync",
    kind: "sync",
    file: "scripts/sync-contract-review-from-sheet.ts",
    line: "9-203",
    purpose:
      "Despite the file name, this syncs diagramUrl only: it lifts the Drive hyperlink attached to each CLEARANCE STATUS cell.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/sync-contract-review-from-sheet.ts --apply",
    sheetTab: "CONTRACTS",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 4,
    columns: cols(
      ["CONTRACT NO", "(join key)"],
      ["ITEM_CODE", "(join key)"],
      ["CLEARANCE STATUS", "diagramUrl", "the hyperlink on the cell, not the cell text"],
    ),
    dbModels: ["ContractReview"],
    writePolicy:
      "Writes only diagramUrl. The hyperlink is not returned by values.get, so it batches spreadsheets.get with includeGridData at 5000 rows per request and also reads textFormatRuns links. First non-empty link per key wins.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/sync-contract-review-from-sheet.ts",
    dryRunDefault: true,
  },
  {
    id: "cr-script-contract-dump",
    name: "CONTRACT DUMP gap-fill seed",
    kind: "seed",
    file: "scripts/backfill-contract-review-contract-dump.ts",
    line: "34-478",
    purpose:
      "One-time seed from BOM MAST ERP that fills ContractReview blanks the main CONTRACTS sync never populated.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run cr:contract-dump:apply",
    sheetTab: "CONTRACT DUMP",
    sheetGid: "1279116711",
    sheetRange: "'<tab>'!A:AF",
    headerRow: 1,
    columns: CONTRACT_DUMP_SEED_COLUMNS,
    dbModels: ["ContractReview"],
    writePolicy:
      "Gap-fill only: a field is written when the DB value is blank AND the sheet value is usable. Never overwrites, never clears. Creates rows for unmatched keys. syncedAt is never written, so this seed cannot re-sort the page. 28 of the 32 sheet headers map; the rest are printed as UNMAPPED. Safe to re-run.",
    cadence: "one-time",
    npmCommand: "npm run cr:contract-dump",
    dryRunDefault: true,
  },
  {
    id: "cr-script-contract-po",
    name: "PO NO and ORDER LIST sync",
    kind: "sync",
    file: "scripts/sync-contract-po.ts",
    line: "8-198",
    purpose:
      "The only live path that populates ContractReview.poNo and orderList now that the page's own backfill is commented out.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/sync-contract-po.ts --apply",
    sheetTab: "CONTRACTS copy",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: cols(
      ["ERP CONTRACT NO", "(join key)"],
      ["PO NO", "poNo", "only written when non-empty and different"],
      ["ATTACHTMENT", "orderList[]", "sic — the misspelling is in the sheet"],
    ),
    dbModels: ["ContractReview"],
    writePolicy:
      "Single-key join on ERP CONTRACT NO. Multiple rows per contract are unioned. poNo overwrites when it differs; orderList is append-only union.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/sync-contract-po.ts",
    dryRunDefault: true,
  },
  {
    id: "cr-script-dates",
    name: "Normalise date of contract",
    kind: "cleanup",
    file: "scripts/normalise-contract-review-dates.ts",
    line: "49-207",
    purpose:
      "Rewrites DATE OF CONTRACT into dd-MMM-yyyy, repairing Excel serials, day-first dates and junk-prefixed values.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run cr:norm-dates:apply",
    dbModels: ["ContractReview"],
    columns: cols([
      "DATE OF CONTRACT",
      "dateOfContract",
      "83 of 3911 rows were off-format at the time of the audit",
    ]),
    writePolicy:
      "Writes only dateOfContract, and only rows that are non-canonical. Every rewrite must round-trip through parseGmdDate or it is rejected. Durable because dateOfContract is in PRESERVE_UI_FIELDS.",
    cadence: "manual",
    npmCommand: "npm run cr:norm-dates",
    dryRunDefault: true,
  },
  {
    id: "cr-script-enquiry",
    name: "Enquiry field backfill (standalone)",
    kind: "backfill",
    file: "scripts/backfill-contract-review-enquiry-fields.ts",
    line: "8-66",
    purpose:
      "Standalone runner for the same state / utility / project-reference backfill the sync and page both invoke.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run cr:backfill-enquiry:apply",
    dbModels: ["ContractReview", "Enquiry"],
    columns: cols(
      ["(Enquiry) state", "state"],
      ["(Enquiry) utility", "utility"],
["(Enquiry) projectReference", "projectReference"],
    ),
    writePolicy:
      "Full 3-field replace in chunks of 500, matched on Enquiry.selectedContractNo. UNMATCHED rows are cleared to null.",
    cadence: "manual",
    npmCommand: "npm run cr:backfill-enquiry",
    dryRunDefault: true,
  },
  {
    id: "cr-script-cleanup-boms",
    name: "Clear invalid BOM IDs",
    kind: "cleanup",
    file: "scripts/remove-invalid-contract-review-boms.ts",
    line: "28-159",
    purpose:
      "Nulls BOM ID on rows whose (itemCode, bomId) pair has no matching VerifyBom row.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run cr:cleanup-invalid-boms:apply",
    dbModels: ["VerifyBom", "ContractReview"],
    columns: cols(
      ["BOM ID", "bomId", "nulled when the pair is absent from VerifyBom"],
      ["RM AVAIL", "noUse", "cleared alongside bomId"],
    ),
    writePolicy: "Writes bomId = null and noUse = null in batches of 50. Safely re-runnable.",
    cadence: "manual",
    npmCommand: "npm run cr:cleanup-invalid-boms",
    dryRunDefault: true,
  },
  {
    id: "cr-script-diagnostics",
    name: "Contract Review diagnostics",
    kind: "diagnostic",
    file: "scripts/peek-contracts-headers.ts, scripts/inspect_cr_items.ts, scripts/_cr-probe.ts",
    line: "—",
    purpose:
      "Three read-only helpers: print the CONTRACTS copy headers with indices, list distinct Item values, and a fully commented-out row probe.",
    direction: "read-only",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/peek-contracts-headers.ts",
    sheetTab: "CONTRACTS copy",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    dbModels: ["ContractReview"],
    writePolicy: "No DB writes at all. _cr-probe.ts is 100% commented out.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/peek-contracts-headers.ts",
    dryRunDefault: true,
  },
  {
    id: "cr-cbatch",
    name: "Batch C mark",
    kind: "sync",
    file: "app/actions.ts:syncCBatchAction",
    line: "5003-5033",
    purpose:
      "Marks cBatch = 'C' on every Contract Review row whose ITEM_CODE has ITEM_STATUS = 'C'.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync C Batch button (on /data-sources)",
    sheetTab: "ITEM MASTER ERP",
    sheetGid: "253020709",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: ITEM_MASTER_COLUMNS,
    dbModels: ["ContractReview"],
    writePolicy: "Set-only on itemCode. Never clears. C BATCH is a hidden column that only feeds the chip in the ITEM_CODE cell.",
    cadence: "every-sync",
  },
];

const BOM_SYNC: SyncOperation[] = [
  {
    id: "bom-grid-read",
    name: "Verify BOM grid read",
    kind: "lookup",
    file: "app/api/bom/route.ts",
    line: "14-59",
    purpose:
      "Returns FullItem -> Bom -> BomItem -> (RawMaterial | FullItem) projected into the 26-column display grid.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    dbModels: ["Bom", "BomItem", "GMDUpdateItem", "ContractReview"],
    writePolicy:
      "Pure read.",
    cadence: "every-page-load",
  },
  {
    id: "bom-verify-bom-sync",
    name: "VERIFY BOM sync",
    kind: "sync",
    file: "app/api/bom/sync/route.ts",
    line: "11-94",
    purpose:
      "The main BOM sync: reads the VERIFY BOM tab and upserts BOM structure rows into VerifyBom.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync button",
    sheetTab: "VERIFY BOM",
    sheetRange: "'VERIFY BOM'!A2:ZZZ",
    headerRow: 2,
    columns: [...VERIFY_BOM_SYNC_COLUMNS, ...VERIFY_BOM_UNREAD],
    dbModels: ["VerifyBom"],
    writePolicy:
      "Upsert on (BOM ID, ITEM CODE, RM ITEM CODE). CREATE writes the 8 mapped fields; UPDATE touches ONLY bomIdType, bomItemQty and syncedAt, so re-syncing can never clobber the other 18 columns. Rows with STATUS OF BOM = closed are skipped and LEFT IN THE DB. Rows deleted from the sheet are never removed. Start row 2 is hard-coded, so inserting a title row above it silently breaks the header match; only the column binding within A:ZZZ is dynamic, by normalised name.",
    cadence: "every-sync",
  },
  {
    id: "bom-meta-sync",
    name: "Item metadata sync",
    kind: "sync",
    file: "app/api/bom/sync-meta/route.ts",
    line: "6-122",
    purpose:
      "Attaches the descriptive item metadata (type, MOC, operation, size, PN) to every RM line of each BOM.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync Item Meta button",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: BOM_META_COLUMNS,
    dbModels: ["VerifyBom"],
    writePolicy:
      "updateMany per distinct itemCode, so every RM line of that BOM is refreshed (fan-out). UNCONDITIONAL overwrite — a blank sheet cell nulls out the DB value. CODE FOR THE ITEM is the join key only; last duplicate wins.",
    cadence: "every-sync",
  },
  {
    id: "bom-missing-stock",
    name: "Missing stock gap-fill",
    kind: "backfill",
    file: "app/actions.ts:syncNullVerifyBomStockAction",
    line: "4435-4531",
    purpose:
      "Fills AVAILABLE STOCK on BOM rows that have none, using the physical stock count.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync Missing Stock button",
    sheetTab: "stock-phys",
    sheetRange: "'stock-phys'!A:ZZZ",
    headerRow: 2,
    columns: STOCK_PHYS_COLUMNS,
    dbModels: ["VerifyBom"],
    writePolicy:
      "Gap-fill only — only rows where availableStock is null or empty. Match order is rmItemCode then itemCode. Never overwrites an existing value. Note the registry previously pointed at line 3701; the real definition is 4435.",
    cadence: "on-demand",
  },
  {
    id: "bom-mast-to-date",
    name: "BOM MAST TO_DATE flow",
    kind: "sync",
    file: "app/actions.ts:buildBomMastSyncPlan + syncBomMastItemNamesAction",
    line: "4536-4913",
    purpose:
      "Marks a BOM line NO USE and batch C as soon as its TO_DATE is set in BOM MAST ERP, and upserts missing lines so they can be marked.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "ItemName (C) button -> confirm dialog -> Run Sync",
    sheetTab: "BOM MAST ERP",
    sheetGid: "1180547059",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: BOM_MAST_COLUMNS,
    dbModels: ["VerifyBom"],
    writePolicy:
      "Writes ONLY noUse = 'NO USE' and cBatch = 'C', for every row with a non-blank TO_DATE — including rows already correct, since the plan counters are informational only. Missing triples are upsert-created with upper-cased keys, which can produce case-variant duplicates. ONE-WAY: nothing in the codebase can set noUse back to USE. 100-row transactions with a 20s timeout.",
    cadence: "every-sync",
  },
  {
    id: "bom-item-master-names",
    name: "ITEM MASTER item names",
    kind: "sync",
    file: "app/actions.ts:syncBomMastItemNamesAction (phase 2)",
    line: "4840-4886",
    purpose:
      "Fills ITEM NAME and RM ITEM NAME on BOM rows from the ERP item master, as part of the same ItemName (C) run.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "ItemName (C) button -> Run Sync (phase 2)",
    sheetTab: "ITEM MASTER ERP",
    sheetGid: "253020709",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: ITEM_MASTER_COLUMNS,
    dbModels: ["VerifyBom"],
    writePolicy:
      "Writes only itemName (from itemCode) and rmItemName (from rmItemCode), and only when the sheet value differs. A blank or missing sheet cell never replaces an existing name.",
    cadence: "every-sync",
  },
  {
    id: "bom-cell-edits",
    name: "Inline cell edits",
    kind: "edit",
    file: "app/actions.ts:updateVerifyBomFieldBatchAction",
    line: "4247-4296",
    purpose:
      "Saves /bom edits: BOM ID TYPE -> Bom, BOM ITEM QTY (whole number) -> BomItem.quantity, the other columns -> FullItem.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit on /bom",
    dbModels: ["Bom", "BomItem", "FullItem"],
    columns: cols(
      ["BOM ID TYPE", "bomIdType"],
      ["BOM ITEM QTY", "bomItemQty"],
      ["ITEM SCHEDULE NAME", "itemScheduleName"],
      ["ITEM TYPE", "itemType"],
      ["MOC", "moc"],
      ["OPERATION", "operation"],
      ["SIZE", "size"],
      ["NO", "no"],
      ["PN-GMD", "pnGmd"],
      ["CURRENT REQT", "currentReqt"],
      ["NEW ITEM NAME", "merged"],
      ["DUPLICATE MERGER COUNT", "duplicateMergerCount"],
      ["BOM NATURE", "bomNature"],
      ["CONSUMPTION-1", "consumption1"],
      ["CONSUMPTION 2", "consumption2"],
      ["CONSUMPTION 3", "consumption3"],
    ),
    writePolicy:
      "Allow-listed by VERIFY_BOM_EDITABLE_FIELDS and mapped through VERIFY_BOM_HEADER_TO_DB_FIELD. Per-id updates in a single transaction.",
    cadence: "on-demand",
    dead: true,
  },
  {
    id: "bom-script-cost",
    name: "BOM cost backfill",
    kind: "backfill",
    file: "scripts/backfill-verify-bom-cost.ts",
    line: "35-175",
    purpose:
      "Pushes the current Raw Material cost onto the COST column of every BOM row.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run bom:cost:derive:apply",
    dbModels: ["GMDUpdateItem", "VerifyBom"],
    columns: cols([
      "(GMDUpdateItem) cost",
      "cost",
      "tried as BOM ID+ITEM CODE, then BOM ID+RM ITEM CODE, then RM ITEM CODE, then ITEM CODE",
    ]),
    writePolicy: "Writes only cost, in 100-row transactions.",
    cadence: "manual",
    npmCommand: "npm run bom:cost:derive",
    dryRunDefault: true,
  },
  {
    id: "bom-script-stock",
    name: "stock-phys -> VerifyBom",
    kind: "backfill",
    file: "scripts/dry-run-verify-bom-missing-stock.ts",
    line: "27-152",
    purpose:
      "CLI version of the Sync Missing Stock button, with the same rmItemCode-then-itemCode match order.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run bom:stock:apply",
    sheetTab: "stock-phys",
    sheetRange: "'stock-phys'!A:ZZZ",
    headerRow: 2,
    columns: STOCK_PHYS_COLUMNS,
    dbModels: ["VerifyBom"],
    writePolicy: "Writes only availableStock, in 100-row transactions. Dry-run unless --apply.",
    cadence: "manual",
    npmCommand: "npm run bom:stock:dry-run",
    dryRunDefault: true,
  },
  {
    id: "bom-script-no-use",
    name: "Strip NO USE BOM IDs from quotations",
    kind: "cleanup",
    file: "scripts/remove-no-use-bom-ids.ts",
    line: "27-183",
    purpose:
      "Keeps quotations off BOM lines that BOM MAST ERP has retired, and clears the selection when a NO USE BOM was already chosen.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run bom:cleanup-no-use:apply",
    dbModels: ["VerifyBom", "EnquiryItem"],
    columns: cols(
      ["USE/NO USE", "availableBomIds", "NO USE bomIds are filtered out"],
      ["BOM ID", "bomId", "nulled when the selected BOM is NO USE"],
      ["(also cleared)", "rmItemCode / bomType / rmType"],
    ),
    writePolicy:
      "Rewrites EnquiryItem.availableBomIds; when the currently selected bomId is NO USE it additionally nulls bomId, rmItemCode, bomType and rmType. Uses --write, not --apply.",
    cadence: "manual",
    npmCommand: "npm run bom:cleanup-no-use",
    dryRunDefault: true,
    sharedWith:
      "Quotation Dashboard — the same NO-USE filter is applied there in-line by syncAvailableBomIds and by the SSR read in app/page.tsx:48",
  },
  {
    id: "bom-script-available-ids",
    name: "Available BOM IDs backfill",
    kind: "backfill",
    file: "scripts/backfill-available-bom-ids.ts",
    line: "26-88",
    purpose:
      "Rebuilds each quotation line's list of selectable BOM IDs from VerifyBom.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/backfill-available-bom-ids.ts --write",
    dbModels: ["VerifyBom", "EnquiryItem"],
    columns: cols([
      "(VerifyBom) USE/NO USE",
      "availableBomIds",
      "distinct bomIds per itemCode minus every NO USE bomId",
    ]),
    writePolicy: "Writes only EnquiryItem.availableBomIds, per item code.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/backfill-available-bom-ids.ts",
    dryRunDefault: true,
    sharedWith:
      "Quotation Dashboard — in the app the same list is rebuilt per row by syncAvailableBomIds (app/actions.ts:1320)",
  },
  {
    id: "bom-script-m2m-stock",
    name: "M2M available stock",
    kind: "backfill",
    file: "scripts/backfill-m2m-available-stock.ts",
    line: "15-58",
    purpose:
      "Copies RM stock and RM type onto DIRECT M2M quotation lines.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/backfill-m2m-available-stock.ts",
    dbModels: ["GMDUpdateItem", "EnquiryItem"],
    columns: cols(
      ["(GMDUpdateItem) Available Stock", "availableStock"],
      ["(GMDUpdateItem) RM TYPE", "rmType"],
    ),
    writePolicy: "Writes EnquiryItem.availableStock and rmType for every item with an rmItemCode.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/backfill-m2m-available-stock.ts",
    sharedWith:
      "Quotation Dashboard — in the app the same copy is syncDirectM2MAvailableStock (lib/directM2MStockLookup.ts), which also recomputes deliverySchedule",
  },
  {
    id: "bom-script-cost-from-sheet",
    name: "Quotation cost from BOM sheet",
    kind: "script",
    file: "scripts/update-product-cost-from-bom.ts, update-2to1-cost-from-bom.ts, dry-run-2to1-cost.ts",
    line: "—",
    purpose:
      "Prices DIRECT M2M and 2:1 quotation lines straight from the GMD Item Creation Form consumption columns.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run bom:cost",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: cols(
      ["CODE FOR THE ITEM", "(join key)"],
      ["ITEM TYPE", "(filter)", 'last occurrence; = "DIRECT M2M" or "2:1"'],
      ["BOM ID", "bomId", "must be non-empty and not '-'"],
      ["CONSUMPTION-1 / CONSUMPTION 2 / CONSUMPTION 3", "productCost / cost", "RM codes starting with F are excluded"],
    ),
    dbModels: ["GMDUpdateItem", "SupplyHistoryItem", "EnquiryItem"],
    writePolicy:
      "DIRECT M2M writes EnquiryItem.productCost only where it is blank; 2:1 writes cost only where it is null / 0 / '-'. Both always write bomId, bomType and rmItemCode. RM unit costs come from SupplyHistoryItem via buildRmCostMap.",
    cadence: "manual",
    npmCommand: "npm run bom:cost",
  },
];

/** Row 1 — item code derivation and BOM linkage. */
const QUOTATION_LINKAGE_SYNC: SyncOperation[] = [
  {
    id: "q-ssr-grid-read",
    name: "Quotation SSR grid read",
    kind: "lookup",
    file: "app/page.tsx",
    line: "14-135",
    purpose:
      "Renders the whole quotation board: every Enquiry with its items, attachments, the next docket number, and all dropdown options. The page touches NO spreadsheet.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load (server component, force-dynamic)",
    dbModels: ["Enquiry", "EnquiryItem", "LookupOption", "Bom", "BomItem"],
    writePolicy:
      "Pure read. Applies a read-time override to availableBomIds: NO-USE bomIds are filtered out on every render, so a stale stored array can never offer a retired BOM. Also derives nextDocketNumber from the current fiscal year (April–March).",
    cadence: "every-page-load",
  },
  {
    id: "q-lookup-options",
    name: "Dropdown lookup options",
    kind: "lookup",
    file: "lib/lookup.ts:getActiveLookupValuesByType",
    line: "3-10",
    purpose:
      "Loads every active LookupOption row grouped by type, which becomes the dropdown option set for the whole page.",
    direction: "read-only",
    trigger: "page-load",
    triggerLabel: "Page load",
    columns: LOOKUP_OPTION_TYPES,
    dbModels: ["LookupOption"],
    writePolicy:
      "Pure read. 18 types. The client merges in distinct values already present on rows, except DELIVERY which is deliberately single-sourced so a stray row value cannot appear as an option.",
    cadence: "every-page-load",
  },
  {
    id: "q-master-sync",
    name: "GMD Item Creation Form snapshot",
    kind: "sync",
    file: "lib/gmdItemCodeLookup.ts:syncGmdItemCodes",
    line: "17-75",
    purpose:
      "The only sheet write path on this page. Copies the master tab into GmdItemCode, which every item-code lookup then reads from the database instead of the sheet.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Fetch Item Codes button (and the 24h staleness gate)",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_ITEMCODE,
    dbModels: ["GmdItemCode"],
    writePolicy:
      "DESTRUCTIVE FULL REPLACE — the only wipe in the registry. deleteMany + createMany inside one transaction, so the table is never half-populated. Rows missing ANY of the 6 required columns are dropped (find r.itemCode && r.itemType && r.moc && r.operation && r.size && r.pnGmd). Throws if any required column is absent from the header row.",
    cadence: "every-sync",
  },
  {
    id: "q-master-staleness",
    name: "Master staleness gate",
    kind: "derived",
    file: "lib/gmdItemCodeLookup.ts:ensureFreshData",
    line: "120-142",
    purpose:
      "Keeps the GmdItemCode snapshot fresh without anyone pressing a button: syncs when the table is empty or the newest row is older than 24 hours.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Any item-code lookup (implicit)",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    dbModels: ["GmdItemCode", "EnquiryItem"],
    writePolicy:
      "On a stale or empty snapshot it runs the destructive sync and then backfills. Note the Fetch Item Codes button bypasses this gate and forces a re-sync every time, so the button is the real refresh path and this only catches background lookups.",
    cadence: "every-sync",
  },
  {
    id: "q-backfill-existing",
    name: "Backfill codes onto blank items",
    kind: "backfill",
    file: "lib/gmdItemCodeLookup.ts:backfillExistingItems",
    line: "77-118",
    purpose:
      "Gives an ERP item code to rows that have the 5 descriptive fields but no code — the legacy rows that predate the master snapshot.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Fired right after every master sync",
    columns: QUOTATION_DERIVED_FIELDS,
    dbModels: ["EnquiryItem"],
    writePolicy:
      "Only rows where erpItemCode IS NULL and all 5 descriptive fields are present. Writes erpItemCode only, one update per item, nothing else.",
    cadence: "every-sync",
  },
  {
    id: "q-itemcode-api",
    name: "Master snapshot API",
    kind: "sync",
    file: "app/api/gmd-item-codes/sync/route.ts",
    line: "4-12",
    purpose: "HTTP wrapper around the master sync for callers outside the page.",
    direction: "sheet-to-db",
    trigger: "api-only",
    triggerLabel: "POST /api/gmd-item-codes/sync — no UI trigger",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_ITEMCODE,
    dbModels: ["GmdItemCode"],
    writePolicy:
      "Same destructive deleteMany + createMany replace as the button path. No dry-run. Reachable only over HTTP.",
    cadence: "manual",
  },
  {
    id: "q-fetch-item-codes",
    name: "Fetch / refresh item codes",
    kind: "sync",
    file: "app/actions.ts:fetchErpItemCodesAction",
    line: "1598-1696",
    purpose:
      "Re-derives the item code for the selected rows from a freshly synced master, then repairs the BOM linkage and cost that belonged to the old code.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Fetch Item Codes button",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_ITEMCODE,
    dbModels: ["GmdItemCode", "EnquiryItem"],
    writePolicy:
      "Forces a full master re-sync (a sync failure is non-fatal — the old snapshot survives) and clears all four sheet caches. Per item: if the code moved it NULLS bomId, bomType, rmItemCode, rmType and availableStock, because those belonged to the old code; productCost is deliberately left alone. Then repopulates availableBomIds and, only where productCost is blank, re-derives cost from the new code.",
    cadence: "every-sync",
  },
  {
    id: "q-refresh-item-code",
    name: "Single-item code refresh",
    kind: "derived",
    file: "lib/gmdItemCodeLookup.ts:refreshItemCodeForItem",
    line: "514-561",
    purpose:
      "Re-derives one item's code and reports whether the master still vouches for it.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Called per item by Fetch Item Codes",
    columns: QUOTATION_DERIVED_FIELDS,
    dbModels: ["EnquiryItem"],
    writePolicy:
      "NEVER nulls a stored code, unlike the field-edit path. A blank field or a combination the master no longer lists is reported as not derivable and leaves the row completely alone, so a bulk refresh cannot strip codes off live dockets.",
    cadence: "every-sync",
  },
  {
    id: "q-recompute-item-code",
    name: "Item code recompute on edit",
    kind: "derived",
    file: "lib/gmdItemCodeLookup.ts:recomputeItemCodeForValues",
    line: "567-590",
    purpose:
      "Re-derives the item code whenever one of the 5 descriptive fields is edited, so the code tracks the item.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit on itemType / moc / size / pnRating / operationType / itemName",
    columns: QUOTATION_DERIVED_FIELDS,
    dbModels: ["EnquiryItem"],
    writePolicy:
      "Writes erpItemCode whenever newCode !== oldCode, and newCode is null when the master has no matching row — so editing a descriptive field CAN blank a code. This contradicts refreshItemCodeForItem, which is explicitly built never to. The BOM gate in lookupItemCodeGated is commented out, so a code is returned even with no BOM.",
    cadence: "on-demand",
  },
  {
    id: "q-select-bom",
    name: "BOM ID selection",
    kind: "edit",
    file: "app/actions.ts:selectBomIdAction",
    line: "1516-1577",
    purpose:
      "Attaches a BOM to an item and pulls across the raw-material code, type, stock and — when blank — the cost.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "BOM ID dropdown",
    dbModels: ["EnquiryItem", "Bom", "BomItem", "GMDUpdateItem", "SupplyHistoryItem"],
    columns: cols(
      ["(Bom) bomId", "bomId", "must already be in availableBomIds"],
      ["(Bom) bomIdType", "bomType", "defaults to DIRECT M2M when blank"],
      ["(Bom) rmItemCode", "rmItemCode"],
      ["(GMDUpdateItem) rmType", "rmType"],
      ["(GMDUpdateItem) Available Stock", "availableStock", "DIRECT M2M only"],
      ["(GMDUpdateItem) cost -> SupplyHistory", "productCost", "only when productCost is null"],
    ),
    writePolicy:
      "Clearing the dropdown nulls bomId, rmItemCode, rmType and bomType. Blocked on frozen enquiries. Cost precedence is Raw Material first, SupplyHistory second. productCost is filled only where it was already null.",
    cadence: "on-demand",
  },
  {
    id: "q-available-bom-ids",
    name: "Available BOM ID list",
    kind: "derived",
    file: "app/actions.ts:syncAvailableBomIds",
    line: "1320-1337",
    purpose:
      "Populates the BOM dropdown options for an item from Bom (via FullItem.itemCode), minus the retired ones.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit and Fetch Item Codes",
    dbModels: ["EnquiryItem", "Bom", "BomItem"],
    columns: cols(
      ["(Bom) bomId", "availableBomIds", "distinct bomIds for the itemCode"],
      ["(Bom) USE/NO USE", "(filtered)", 'BOMs with any BomItem.noUse = "NO USE" are excluded'],
    ),
    writePolicy:
      "Uses updateMany across EVERY row sharing the erpItemCode, so the same item code always shows the same list — this is what prevents blank-vs-dropdown divergence. Never reintroduces a NO-USE bomId. A null code clears the array.",
    cadence: "on-demand",
  },
  {
    id: "q-product-cost-fallback",
    name: "Cost fill after a code change",
    kind: "derived",
    file: "app/actions.ts:maybeUpdateProductCostFromNewCode",
    line: "1344-1482",
    purpose:
      "Fills the cost, stock and BOM type that a freshly derived code makes derivable, without disturbing anything already filled in.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit and Fetch Item Codes",
    dbModels: ["EnquiryItem", "Bom", "BomItem", "GMDUpdateItem", "IndentListing"],
    columns: cols(
      ["(Bom) bomId", "bomId / rmItemCode", "left null when several candidates exist"],
      ["(GMDUpdateItem) cost", "productCost"],
      ["(GMDUpdateItem) Available Stock", "availableStock"],
      ["(GMDUpdateItem) rmType", "bomType / rmType"],
      ["(EnquiryItem) costRefCode", "(ephemeral bomId)", "used as a stand-in when no BOM is selected"],
    ),
    writePolicy:
      "FILL-ONLY — never overwrites a value that is already present. Defers when Bom has several BOMs for the code, because the choice is the user's. costRefCode is treated as an ephemeral bomId, so bomId itself stays null.",
    cadence: "on-demand",
  },
  {
    id: "q-item-field-cascade",
    name: "Item cell-edit cascade",
    kind: "edit",
    file: "app/actions.ts:updateItemFieldAction",
    line: "1069-1315",
    purpose:
      "The central write path for the grid. One cell edit fans out into re-derivation, cost recalculation, BOM refresh and delivery scheduling.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Any cell edit, dropdown change or paste",
    dbModels: ["EnquiryItem", "Enquiry"],
    columns: cols(
      ["itemName", "itemType / moc / size / pnRating / bypass", "full re-resolution from the new name"],
      ["itemType", "itemTypeSource", 'marked "sheet" when typed by hand'],
      ["moc", "mocSource", 'marked "sheet" when typed by hand'],
      ["rmType", "bomId", "back-calculated when bomId is blank"],
      ["itemType, moc, size, pnRating, operationType, extension, bypass, others, itemName", "itemNameMerge", "the 9 MERGE_FIELDS"],
      ["itemType, moc, size, pnRating, operationType, itemName", "erpItemCode", "the 6 CODE_DERIVED_FIELDS, then availableBomIds, then productCost"],
      ["quantity, availableStock, size, itemType, itemName, importedInhouse", "deliverySchedule"],
      ["productCost, extension, bypass, quantity, vaPercent, quotedRate, cost", "cost / vaPercent / quotedRate / GST / totals", "routed through the cost engine"],
    ),
    writePolicy:
      "Two rules make this safe to call for any field. FROZEN_ITEM_FIELD_SET columns are refused once the enquiry's offer PDF is generated unless APM is reverted. And `data: { [field]: parsedVal }` has NO field allow-list, so any column name the client sends is writable — the same unguarded pattern as the Raw Material grid.",
    cadence: "on-demand",
  },
];

/** Row 2 — the cost engine. */
const QUOTATION_COST_SYNC: SyncOperation[] = [
  {
    id: "q-cost-engine",
    name: "Cost / rate / total engine",
    kind: "derived",
    file: "lib/costCalculator.ts:recalculateItem",
    line: "82-286",
    purpose:
      "The single formula behind every number in the cost block. Nothing writes cost, VA%, quoted rate, GST or the totals except through here.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Fired by any cost, extension, bypass, quantity, VA% or rate change",
    dbModels: [
      "EnquiryItem",
      "ExtensionCost",
      "BypassCost",
      "PaymentTermsCost",
      "InspectionCost",
      "PbgCost",
      "TransportationCost",
    ],
    columns: QUOTATION_CALC_COLUMNS,
    writePolicy:
      "cost = productCost x 1.08 + extension + bypass + productCost x 1.08 x (payment% + inspection% + PBG% + transport%). Transportation switches partLoad to fullLoad at productCost >= 5,000,000. VA% and quotedRate are mutually anchoring: whichever one the user set is kept and the other is derived from it; if neither was set, quotedRate wins as the anchor. An explicit user clear is respected and never re-filled. quotedRate is rounded up via roundUp().",
    cadence: "on-demand",
  },
  {
    id: "q-update-product-cost",
    name: "DIRECT M2M product cost",
    kind: "backfill",
    file: "app/actions.ts:updateProductCostFromBomAction",
    line: "1700-1945",
    purpose:
      "Prices DIRECT M2M items from the raw-material cost of their consumption code, including a no-BOM path via the indent listing.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Update Product Cost button",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_BOM,
    dbModels: ["EnquiryItem", "GMDUpdateItem", "SupplyHistoryItem", "IndentListing"],
    writePolicy:
      "FILL-ONLY: writes productCost only where it is null. Cost precedence is Raw Material (GMDUpdateItem.cost) FIRST, SupplyHistory value/quantity SECOND, and the SupplyHistory path is consulted only for codes Raw Material does not have. Resolution order is costRefCode direct match first (when no BOM is selected), then the sheet BOM path. Blocked on frozen enquiries.",
    cadence: "every-sync",
  },
  {
    id: "q-update-2to1-cost",
    name: "2:1 BOM cost",
    kind: "backfill",
    file: "app/actions.ts:update2to1CostAction -> lib/gmd2to1CostLookup.ts:update2to1CostForItems",
    line: "1946-1978 / 172-253",
    purpose:
      "Prices 2:1 items by summing the raw-material cost of every consumption code in the recipe.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Update 2:1 Cost button",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_2TO1,
    dbModels: ["EnquiryItem", "GMDUpdateItem"],
    writePolicy:
      "FILL-ONLY: skips any item whose cost is already non-null and above zero. Always writes bomId and bomType = 2:1 once a recipe matches. Codes starting with F are excluded from the sum, and a blank or '-' BOM ID means no recipe. Blocked on frozen enquiries.",
    cadence: "every-sync",
  },
  {
    id: "q-update-all-bom-costs",
    name: "Update all BOM costs",
    kind: "backfill",
    file: "app/actions.ts:updateAllBomCostsAction",
    line: "1981-2043",
    purpose: "One button that runs DIRECT M2M pricing, 2:1 pricing and the stock refresh in order.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Update All BOM Costs button",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: [...GMD_ITEM_FORM_BOM, ...GMD_ITEM_FORM_2TO1],
    dbModels: ["EnquiryItem", "GMDUpdateItem", "SupplyHistoryItem", "IndentListing"],
    writePolicy:
      "Composition only — it inherits the fill-only rules of the two paths it calls, then refreshes availableStock for the touched rows. Errors from the first path are collected and only surfaced if nothing at all was updated.",
    cadence: "every-sync",
  },
  {
    id: "q-rm-cost-fallback",
    name: "Supply History RM cost fallback",
    kind: "lookup",
    file: "lib/gmdBomCostLookup.ts:buildRmCostMap",
    line: "158-205",
    purpose:
      "Computes a raw-material unit cost from supply rows for the codes Raw Material does not price.",
    direction: "read-only",
    trigger: "button",
    triggerLabel: "Fired inside every cost path",
    dbModels: ["SupplyHistoryItem"],
    columns: cols(
      ["(Supply History) ERP ITEM CODE", "erpItemCode", "matched against the BOM rmItemCode"],
      ["(Supply History) Quantity", "quantity", "divisor; rows with qty <= 0 are skipped"],
      ["(Supply History) Value", "value", "dividend; commas stripped"],
      ["(Supply History) Date", "date", "DD-Mmm-YY; the newest row wins"],
    ),
    writePolicy:
      "Read-only. unitCost = value / quantity on the newest row; a tie on the date breaks toward the HIGHER cost, so a duplicated invoice cannot silently underprice.",
    cadence: "on-demand",
  },
  {
    id: "q-auto-fill-blanks",
    name: "Auto-fill blank descriptors",
    kind: "derived",
    file: "app/actions.ts:autoFillBlanksAction",
    line: "2113-2191",
    purpose:
      "Fills the descriptive columns that are still blank by reading the item name, then seeds a default VA% where one is missing.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Auto Fill Blanks button",
    dbModels: ["EnquiryItem"],
    columns: cols(
      ["itemName", "itemType / moc / size / pnRating / operationType / extension / bypass", "the input for every rule"],
      ["(lookup table)", "vaPercent", "default VA% from the item type + size table"],
    ),
    writePolicy:
      "GAP-FILL ONLY, with targeted exceptions. itemType, moc, size, pnRating, operationType, extension and bypass are written only when blank or '-' / 'Not detectable'. One deliberate exception: pnRating is written whenever a value resolves, overwriting the stored one. vaPercent is applied only where it is currently empty.",
    cadence: "on-demand",
  },
  {
    id: "q-update-va-percent",
    name: "Default VA% fill",
    kind: "backfill",
    file: "app/actions.ts:updateVaPercentAction",
    line: "2194-2246",
    purpose:
      "Fills blank VA% values from the default table, keyed on item type and size.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Update VA% button",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(internal table)",
      "vaPercent",
      "default per itemType + size; blocked on frozen enquiries",
    ]),
    writePolicy:
      "GAP-FILL ONLY — never overwrites a VA% the user set. Goes through the cost engine, so a new VA% also re-derives quotedRate, GST and the totals.",
    cadence: "on-demand",
  },
  {
    id: "q-contract-review-rates",
    name: "Contract Review rates + cost ref",
    kind: "backfill",
    file: "app/actions.ts:fetchContractReviewRatesAction",
    line: "5352-5535",
    purpose:
      "Pulls the winning contract rate for each item code from Contract Review, and backfills the cost code reference from the same source.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Fetch Contract Review Rates button",
    dbModels: ["EnquiryItem", "ContractReview"],
    columns: cols(
      ["(Contract Review) RATE", "contractReviewRate", "the row with the newest DATE OF CONTRACT wins, then createdAt"],
      ["(Contract Review) COST CODE REF", "costRefCode", "matched case-insensitively via normalizeContractKey"],
    ),
    writePolicy:
      "GAP-FILL ONLY on contractReviewRate. The rate lookup keys off raw strings with a case-sensitive match, which is why the cost-ref query is deliberately a separate case-insensitive call — combining them would silently change which rate rows match.",
    cadence: "on-demand",
  },
  {
    id: "q-pd-cost-validation",
    name: "PD cost validation %",
    kind: "derived",
    file: "app/actions.ts:populatePdCostValidationAction",
    line: "5536-5577",
    purpose:
      "Computes the variance between the contract rate and the product cost, as a formatted percentage.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Populate PD Cost Validation button",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(contractReviewRate - productCost) / productCost x 100",
      "pdcostValidation",
      "skipped when either input is missing or productCost is 0",
    ]),
    writePolicy:
      "UNCONDITIONAL overwrite of pdcostValidation for every row that has both a rate and a non-zero cost. Always recomputed, never preserved.",
    cadence: "on-demand",
  },
  {
    id: "q-clear-quoted-rates",
    name: "Clear quoted rates",
    kind: "edit",
    file: "app/actions.ts:clearQuotedRatesAction",
    line: "5580-5685",
    purpose:
      "Wipes the quoted rate and everything derived from it across the selected rows, keeping VA% as the surviving anchor.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Clear Quoted Rates button",
    dbModels: ["EnquiryItem"],
    columns: cols(
      ["(cleared)", "quotedRate"],
      ["(cleared)", "quotedRateGst"],
      ["(cleared)", "totalValue"],
      ["(cleared)", "itemWiseTotalValue"],
      ["(kept)", "vaPercent", "explicitly preserved"],
    ),
    writePolicy:
      "Clears the rate chain but deliberately preserves vaPercent so the row can be re-priced. Refuses the whole run if any parent enquiry is frozen, or if any supplied id does not exist.",
    cadence: "on-demand",
  },
];

/** Row 3 — enquiry and item records. */
const QUOTATION_CRUD_SYNC: SyncOperation[] = [
  {
    id: "q-enquiry-crud",
    name: "Enquiry & item CRUD",
    kind: "edit",
    file: "app/actions.ts",
    line: "33-1068, 795, 179-234",
    purpose:
      "Create, edit and delete enquiries and their line items, plus the per-row bulk toggles. Grouped because none of it reads a spreadsheet.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Dialogs, inline edit, delete buttons",
    dbModels: ["Enquiry", "EnquiryItem"],
    columns: cols(
      ["(form)", "Enquiry fields", "docketNumber, partyName, enquiryDate, state, paymentTerms, inspection, pbg, apm, enquiryType"],
      ["(form)", "EnquiryItem.itemName / quantity", "a new item starts life with no code, cost or BOM"],
      ["(bulk toggle)", "EnquiryItem.validation", "PD cost validation flag"],
      ["(bulk toggle)", "Enquiry.apm", "approval state; combined with offerPdfGeneratedAt it freezes the rate columns"],
    ),
    writePolicy:
      "Standard CRUD. Delete cascades to items (onDelete: Cascade). Every mutation returns the re-serialised row so the client never has to guess. The one cross-cutting rule is the freeze: once offerPdfGeneratedAt is set and apm is 'Yes', the cost block is read-only until APM is reverted.",
    cadence: "on-demand",
  },
  {
    id: "q-import-excel",
    name: "Excel import",
    kind: "edit",
    file: "app/actions.ts:importExcelDataAction",
    line: "2063-2112",
    purpose: "Bulk-fills cost and quoted rate on existing rows from an uploaded spreadsheet.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Import Excel button",
    dbModels: ["EnquiryItem"],
    columns: cols(
      ["docketNumber", "(join key)"],
      ["itemName", "(join key)"],
      ["cost", "cost"],
      ["quotedRate", "quotedRate"],
    ),
    writePolicy:
      "Overwrites cost and quoted rate on the matched rows, then routes through the cost engine so VA%, GST and the totals stay consistent. Rows are matched on docket number plus item name.",
    cadence: "on-demand",
  },
  {
    id: "q-sync-m2m-stock",
    name: "RM stock & type refresh",
    kind: "backfill",
    file: "app/actions.ts:syncDirectM2MAvailableStockAction -> lib/directM2MStockLookup.ts",
    line: "2047-2061 / 65-116",
    purpose:
      "Copies raw-material stock, RM type and the resulting delivery schedule onto every item that has an RM code.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync Available Stock button, or the last step of Update All BOM Costs",
    dbModels: ["GMDUpdateItem", "EnquiryItem"],
    columns: cols(
      ["(GMDUpdateItem) Available Stock", "availableStock", '"0" is kept; blank values are skipped'],
      ["(GMDUpdateItem) RM TYPE", "rmType"],
      ["(derived)", "deliverySchedule", "recomputed whenever the stock value changes"],
    ),
    writePolicy:
      "Applies to any item with an rmItemCode, not just DIRECT M2M. Writes only where the value actually differs. When stock changes the delivery schedule is recomputed; a schedule that resolves to null leaves the stored one alone.",
    cadence: "every-sync",
  },
  {
    id: "q-delivery-schedule",
    name: "Delivery schedule recompute",
    kind: "derived",
    file: "app/actions.ts:syncDeliveryScheduleForItem",
    line: "1299-1303",
    purpose:
      "Recomputes the promised delivery schedule whenever any of its six inputs change.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit on quantity / availableStock / size / itemType / itemName / importedInhouse",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(derived)",
      "deliverySchedule",
      "from quantity, availableStock, size, itemType and the import/in-house class",
    ]),
    writePolicy: "Writes only deliverySchedule, and only when the recomputed value differs.",
    cadence: "on-demand",
  },
  {
    id: "q-import-inhouse-class",
    name: "Import / in-house classification",
    kind: "derived",
    file: "lib/importInhouseMapping.ts:resolveImportedInhouse",
    line: "1179-1187",
    purpose:
      "Classifies each item as imported or in-house so the stock and delivery logic knows which rules apply.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Cell edit on itemType / size / itemName",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(derived)",
      "importedInhouse",
      "from itemType + size; a direct edit is left untouched as a manual override",
    ]),
    writePolicy:
      "Re-derived whenever a source field changes, but a value the user typed into importedInhouse itself is never overwritten.",
    cadence: "on-demand",
  },
  {
    id: "q-email-addresses",
    name: "Party email address sync",
    kind: "sync",
    file: "app/actions.ts:syncEnquiryEmailAddressesAction -> lib/enquiryEmailSync.ts",
    line: "933-1067",
    purpose:
      "Fills each enquiry's senderEmail (the thread sender, future email To) and emailAddress (the cc/rest list, future Cc). Falls back to the most recent docket of the same party (resolved from its source thread) when the thread has no usable external email; internal addresses are never stored.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Sync Email Addresses button",
    dbModels: ["DocketQuotationThread", "Enquiry"],
    columns: cols([
      "(thread) sender / to_details / cc_details",
      "Enquiry.senderEmail (To)",
      "Enquiry.emailAddress (Cc)",
    ]),
    writePolicy:
      "Blank-only by default in the button/script form (onlyBlank: true), so an address already on the enquiry is never replaced. The sender/cc split backfill (scripts/backfill-enquiry-sender-email.ts) re-derives both from the source thread and overwrites.",
    cadence: "on-demand",
  },
  {
    id: "q-offer-pdf-freeze",
    name: "Offer PDF freeze guard",
    kind: "edit",
    file: "lib/oneClickAccess.ts",
    line: "—",
    purpose:
      "Locks the rate and cost block once an offer letter has been issued, so a priced quotation cannot be silently re-priced.",
    direction: "db-to-db",
    trigger: "button",
    triggerLabel: "Enforced inside every cost-affecting action",
    dbModels: ["Enquiry", "EnquiryItem"],
    columns: cols(
      ["(Enquiry) offerPdfGeneratedAt", "freeze trigger"],
      ["(Enquiry) apm", "freeze condition", "frozen when apm = 'Yes' and a PDF exists"],
      ["(blocked)", "FROZEN_ITEM_FIELD_SET", "quotedRate, vaPercent, cost, productCost, quantity and related columns"],
    ),
    writePolicy:
      "Not a write — a refusal. Every cost, rate and BOM action re-checks the parent enquiry first and returns an error naming the frozen row count rather than silently skipping.",
    cadence: "on-demand",
  },
  {
    id: "q-cbatch",
    name: "Batch C mark",
    kind: "sync",
    file: "app/actions.ts:syncCBatchAction",
    line: "5069-5104",
    purpose:
      "Marks cBatch = 'C' on every enquiry item whose ERP code OR RM code has ITEM_STATUS = 'C', surfaced as a chip in the item-code cell.",
    direction: "sheet-to-db",
    trigger: "button",
    triggerLabel: "Sync C Batch button (on /data-sources)",
    sheetTab: "ITEM MASTER ERP",
    sheetGid: "253020709",
    sheetRange: "'<tab>'!A1:ZZZ",
    headerRow: 1,
    columns: ITEM_MASTER_COLUMNS,
    dbModels: ["EnquiryItem"],
    writePolicy:
      "Set-only on erpItemCode OR rmItemCode, chunked at 1000. Never clears. cBatch is a hidden column that only feeds the chip.",
    cadence: "every-sync",
  },
];

/** Row 4 — seeded reference data and the six cost tables. */
const QUOTATION_SEED_SYNC: SyncOperation[] = [
  {
    id: "q-seed-lookups",
    name: "Dropdown option seed",
    kind: "seed",
    file: "scripts/seed-lookup-options.ts",
    line: "257-274",
    purpose:
      "Defines every dropdown list on the quotation board. Nothing here comes from a spreadsheet — the values are hard-coded in the script.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run seed:lookups",
    columns: LOOKUP_OPTION_TYPES,
    dbModels: ["LookupOption"],
    writePolicy:
      "Upsert per (type, value). Seeds 18 types. Several draw from shared pattern modules so the dropdowns and the keyword matchers cannot drift apart.",
    cadence: "manual",
    npmCommand: "npm run seed:lookups",
  },
  {
    id: "q-seed-extension-costs",
    name: "Extension cost seed",
    kind: "seed",
    file: "scripts/seed-extension-costs.ts",
    line: "—",
    purpose: "Flat cost added per extension variant.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-extension-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["ExtensionCost"],
    writePolicy:
      "Upsert keyed on length. No dry-run — always writes. Feeds costCalculator as a flat rupee addition.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-extension-costs.ts",
  },
  {
    id: "q-seed-bypass-costs",
    name: "Bypass cost seed",
    kind: "seed",
    file: "scripts/seed-bypass-costs.ts",
    line: "—",
    purpose: "Flat cost added per bypass variant.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-bypass-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["BypassCost"],
    writePolicy:
      "Upsert keyed on size. No dry-run. Feeds costCalculator as a flat rupee addition.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-bypass-costs.ts",
  },
  {
    id: "q-seed-payment-term-costs",
    name: "Payment terms cost seed",
    kind: "seed",
    file: "scripts/seed-payment-terms-costs.ts",
    line: "—",
    purpose: "Percentage surcharge applied from the enquiry's payment terms.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-payment-terms-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["PaymentTermsCost"],
    writePolicy:
      "Upsert keyed on terms. No dry-run. A percentage multiplier on productCost x 1.08, so changing this table silently re-prices every existing quotation on its next recalculation.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-payment-terms-costs.ts",
  },
  {
    id: "q-seed-inspection-costs",
    name: "Inspection cost seed",
    kind: "seed",
    file: "scripts/seed-inspection-costs.ts",
    line: "—",
    purpose: "Percentage surcharge applied from the enquiry's inspection type.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-inspection-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["InspectionCost"],
    writePolicy:
      "Upsert keyed on type. No dry-run. Percentage multiplier, same re-pricing caveat as the payment terms table.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-inspection-costs.ts",
  },
  {
    id: "q-seed-pbg-costs",
    name: "PBG cost seed",
    kind: "seed",
    file: "scripts/seed-pbg-costs.ts",
    line: "—",
    purpose: "Percentage surcharge applied from the enquiry's performance-bank-guarantee type.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-pbg-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["PbgCost"],
    writePolicy:
      "Upsert keyed on pbg. No dry-run. Percentage multiplier, same re-pricing caveat as the payment terms table.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-pbg-costs.ts",
  },
  {
    id: "q-seed-transportation-costs",
    name: "Transportation cost seed",
    kind: "seed",
    file: "scripts/seed-transportation-costs.ts",
    line: "—",
    purpose:
      "State-wise transport surcharge, split into part-load and full-load percentages.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/seed-transportation-costs.ts",
    columns: COST_TABLE_SEEDS,
    dbModels: ["TransportationCost"],
    writePolicy:
      "Upsert keyed on state. No dry-run. The only percentage table with a threshold: fullLoad applies once productCost reaches 5,000,000, otherwise partLoad. State matching is forgiving — the raw value, a normalised alias, and a 'FOR (Site In X)' row are all tried.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/seed-transportation-costs.ts",
  },
];

/** Row 5 — maintenance scripts. */
const QUOTATION_SCRIPT_SYNC: SyncOperation[] = [
  {
    id: "q-script-refresh-item-codes",
    name: "Item code re-derivation",
    kind: "script",
    file: "scripts/refresh-item-codes.ts",
    line: "748",
    purpose:
      "Bulk re-derivation of every non-null item code from the master, plus the BOM linkage that follows from it.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run itemcode:refresh:apply",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: [...GMD_ITEM_FORM_ITEMCODE, ...QUOTATION_DERIVED_FIELDS],
    dbModels: ["EnquiryItem", "VerifyBom"],
    writePolicy:
      "Only rows with a non-null code are considered; blank codes belong to backfillExistingItems. NEVER writes any cost column — productCost, cost, vaPercent, quotedRate and totalValue are left exactly as they are. --blank-unmatched additionally nulls the code and BOM linkage where the master cannot vouch for it, and --blank-unmatched-except=<code> spares one code. Dry-run by default.",
    cadence: "manual",
    npmCommand: "npm run itemcode:refresh",
    dryRunDefault: true,
  },
  {
    id: "q-script-product-cost-from-bom",
    name: "DIRECT M2M cost from BOM sheet",
    kind: "script",
    file: "scripts/update-product-cost-from-bom.ts",
    line: "—",
    purpose:
      "Bulk prices DIRECT M2M items straight from the sheet recipe, without going through the page.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run bom:cost",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_BOM,
    dbModels: ["EnquiryItem", "GMDUpdateItem", "SupplyHistoryItem"],
    writePolicy:
      "Writes productCost only where it is blank, and always writes bomId, bomType = DIRECT M2M and rmItemCode. Raw Material cost first, SupplyHistory second. No dry-run flag.",
    cadence: "manual",
    npmCommand: "npm run bom:cost",
  },
  {
    id: "q-script-2to1-cost",
    name: "2:1 cost from BOM sheet",
    kind: "script",
    file: "scripts/update-2to1-cost-from-bom.ts",
    line: "—",
    purpose: "Bulk prices 2:1 items by summing their consumption codes.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/update-2to1-cost-from-bom.ts",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_2TO1,
    dbModels: ["EnquiryItem", "GMDUpdateItem"],
    writePolicy:
      "Writes cost only where it is null, 0 or '-', and always writes bomId and bomType = 2:1. Uses the raw-material cost table only. No dry-run flag; use dry-run-2to1-cost.ts to preview.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/update-2to1-cost-from-bom.ts",
  },
  {
    id: "q-script-dry-run-2to1",
    name: "2:1 cost preview",
    kind: "diagnostic",
    file: "scripts/dry-run-2to1-cost.ts",
    line: "—",
    purpose:
      "Reports which 2:1 items would receive a cost, and which would not, without writing anything.",
    direction: "read-only",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/dry-run-2to1-cost.ts",
    dbModels: ["EnquiryItem"],
    writePolicy: "Writes nothing by design — the whole point of the script.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/dry-run-2to1-cost.ts",
    dryRunDefault: true,
  },
  {
    id: "q-script-recalc-productcost-itemcode",
    name: "Product cost recalculation by item code",
    kind: "script",
    file: "scripts/recalculate-productcost-with-itemcode.ts",
    line: "121",
    purpose:
      "Recalculates productCost for every item that has an ERP code, with a database fallback if the sheet is unreachable.",
    direction: "sheet-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/recalculate-productcost-with-itemcode.ts --dry",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_BOM,
    dbModels: ["EnquiryItem", "VerifyBom", "SupplyHistoryItem"],
    writePolicy:
      "Falls back to distinct VerifyBom rows when fetchBomRows throws, so a sheet outage degrades instead of stopping the run. Uses --dry (not --dry-run) for the preview. RM cost comes from the SupplyHistory path only.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/recalculate-productcost-with-itemcode.ts",
    dryRunDefault: true,
  },
  {
    id: "q-script-verify-product-cost",
    name: "Product cost audit report",
    kind: "diagnostic",
    file: "scripts/verify-product-cost.ts",
    line: "275",
    purpose:
      "Compares stored productCost against a freshly computed one and writes the mismatches to a CSV.",
    direction: "read-only",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/verify-product-cost.ts",
    sheetTab: "GMD Item Creation Form",
    sheetGid: "2142407502",
    sheetRange: "'<tab>'!A:ZZZ",
    headerRow: 1,
    columns: GMD_ITEM_FORM_BOM,
    dbModels: ["EnquiryItem", "VerifyBom", "SupplyHistoryItem"],
    writePolicy:
      "Read-only against the database — the only output is the CSV report. Same VerifyBom fallback as the recalculation script.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/verify-product-cost.ts",
    dryRunDefault: true,
  },
  {
    id: "q-script-recalc-all-costs",
    name: "Recalculate every cost",
    kind: "script",
    file: "scripts/recalculate-all-costs.ts",
    line: "63",
    purpose:
      "Runs the cost engine over every item that already has a productCost, so a change to any cost table is applied everywhere at once.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/recalculate-all-costs.ts",
    dbModels: ["EnquiryItem"],
    columns: QUOTATION_CALC_COLUMNS,
    writePolicy:
      "UNCONDITIONAL. Re-prices every item with a productCost — this is the script to run after editing a seeded cost table, and it will move quoted rates, VA%, GST and totals with them. Reads .env manually so it runs standalone. No dry-run guard.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/recalculate-all-costs.ts",
  },
  {
    id: "q-script-round-quoted-rate",
    name: "Round quoted rates",
    kind: "cleanup",
    file: "scripts/round-qr.ts",
    line: "—",
    purpose:
      "Retroactively rounds quotedRate to the nearest 10 and rebuilds VA%, GST and the totals from the rounded value.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run round:qr:apply",
    dbModels: ["EnquiryItem"],
    columns: cols(
      ["(rounded)", "quotedRate", "to the nearest 10"],
      ["(recomputed)", "vaPercent", "from the rounded rate and cost"],
      ["(recomputed)", "quotedRateGst / totalValue / itemWiseTotalValue"],
    ),
    writePolicy:
      "One-time fix that stays re-runnable — already-rounded rows are skipped. Dry-run unless --apply. Note this overrides the roundUp() the cost engine applies on new rates.",
    cadence: "manual",
    npmCommand: "npm run round:qr",
    dryRunDefault: true,
  },
  {
    id: "q-script-migrate-va-percent",
    name: "Copy enquiry VA% onto items",
    kind: "cleanup",
    file: "scripts/migrate-va-percent.ts",
    line: "46",
    purpose:
      "Copies the enquiry-level VA% down onto every one of its items.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/migrate-va-percent.ts",
    dbModels: ["Enquiry", "EnquiryItem"],
    columns: cols([
      "(Enquiry) vaPercent",
      "EnquiryItem.vaPercent",
      "one update per item",
    ]),
    writePolicy:
      "UNCONDITIONAL OVERWRITE with no dry-run guard and no npm script — it always writes. It ignores each item's own VA%, so run it only if the enquiry level really is the source of truth.",
    cadence: "one-time",
    npmCommand: "npx tsx scripts/migrate-va-percent.ts",
  },
  {
    id: "q-script-fill-order-status",
    name: "Order status backfill",
    kind: "diagnostic",
    file: "scripts/fill-order-status.ts",
    line: "—",
    purpose:
      "Lists enquiries that have a selected contract number but no order status, so someone can decide what to set.",
    direction: "read-only",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/fill-order-status.ts",
    dbModels: ["Enquiry"],
    writePolicy:
      "Dry-run only — the script logs a plan and matching rows and writes nothing at all.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/fill-order-status.ts",
    dryRunDefault: true,
  },
  {
    id: "q-script-item-name-merge",
    name: "Item name merge backfill",
    kind: "backfill",
    file: "scripts/backfill-item-name-merge.ts",
    line: "112",
    purpose:
      "Rebuilds itemNameMerge so it carries the selected Other values as a -WITH- suffix.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run backfill:item-name-merge:apply",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(itemType-moc-size-pnRating-operationType-extension-bypass + others)",
      "itemNameMerge",
      "only rows whose computed value differs",
    ]),
    writePolicy:
      "Idempotent — only rows where the computed merge differs from the stored value are touched. Dry-run without --apply.",
    cadence: "manual",
    npmCommand: "npm run backfill:item-name-merge",
    dryRunDefault: true,
  },
  {
    id: "q-script-import-inhouse",
    name: "Import / in-house backfill",
    kind: "backfill",
    file: "scripts/backfill-import-inhouse.ts",
    line: "—",
    purpose:
      "Derives importedInhouse for existing rows and recomputes the delivery schedule it implies.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run import:backfill:apply",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(itemType + size)",
      "importedInhouse",
      "and the resulting deliverySchedule",
    ]),
    writePolicy:
      "Writes importedInhouse and deliverySchedule together, since the schedule depends on the class. Dry-run without --apply.",
    cadence: "manual",
    npmCommand: "npm run import:backfill",
    dryRunDefault: true,
  },
  {
    id: "q-script-delivery-schedule",
    name: "Delivery schedule backfill",
    kind: "backfill",
    file: "scripts/backfill-delivery-schedule.ts",
    line: "—",
    purpose:
      "Recomputes deliverySchedule across existing rows from the current stock and quantity.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npm run delivery:backfill:apply",
    dbModels: ["EnquiryItem"],
    columns: cols([
      "(quantity + availableStock + size + itemType)",
      "deliverySchedule",
    ]),
    writePolicy:
      "Writes only deliverySchedule. Dry-run without --apply. Two lookup seeds also exist: sync-delivery-schedule-lookup.ts and sync-closure-status-lookup.ts, which populate the DELIVERY and CLOSURE_STATUS dropdowns.",
    cadence: "manual",
    npmCommand: "npm run delivery:backfill",
    dryRunDefault: true,
  },
  {
    id: "q-script-derived-cleanups",
    name: "Derived-field cleanup family",
    kind: "cleanup",
    file: "scripts/cleanup-invalid-*.ts, fix-*.ts, populate-blank-*.ts, populate-all-blanks.ts, clear-orphaned-bypasses.ts, backfill-rmtype-common.ts",
    line: "—",
    purpose:
      "Ten scripts that all do the same job in different guises: normalise or refill one of the derived descriptive columns so it matches the dropdown set.",
    direction: "db-to-db",
    trigger: "manual-script",
    triggerLabel: "npx tsx scripts/<name>.ts [--dry-run]",
    dbModels: ["EnquiryItem"],
    columns: QUOTATION_CLEANUP_COLUMNS,
    writePolicy:
      "All follow one pattern: inspect, log what would change, and write only with --dry-run omitted. cleanup-invalid-item-types / -mocs / -sizes and fix-invalid-sizes / fix-misclassified-mocs normalise a stored value; populate-blank-item-types / -sizes / -extensions / -operation-types / -pn-ratings / -bypasses and populate-all-blanks fill empty ones; clear-orphaned-bypasses resets bypass to '-' and recalculates cost; backfill-rmtype-common sets rmType to COMMON.",
    cadence: "manual",
    npmCommand: "npx tsx scripts/cleanup-invalid-mocs.ts",
    dryRunDefault: true,
  },
];

export const DATA_SOURCES: DataSource[] = [
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard — item code & BOM linkage",
    sheetName: "GMD ERP Master (GMD Item Creation Form)",
    purpose:
      "Reads Postgres, but auto-fills the ERP item code / BOM linkage by reading the sheet directly. The page touches no spreadsheet on load; every sheet read happens on demand.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      {
        name: "GMD Item Creation Form",
        gid: "2142407502",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "gid",
        note: "snapshotted into GmdItemCode; the 5-field composite lookup runs against that table, not the sheet",
        file: "lib/gmdItemCodeLookup.ts, gmdBomCostLookup.ts, gmd2to1CostLookup.ts",
      },
    ],
    sync: QUOTATION_LINKAGE_SYNC,
  },
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard — cost engine",
    sheetName: "GMD ERP Master + Supply History (RM cost)",
    purpose:
      "Prices every line item. Raw-material cost is read from the database, synced from these two sheets.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      {
        name: "GMD Item Creation Form",
        gid: "2142407502",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "gid",
        note: "DIRECT M2M and 2:1 recipes; ITEM TYPE is matched with lastIndexOf",
        file: "lib/gmdBomCostLookup.ts:fetchBomRows, lib/gmd2to1CostLookup.ts:fetch2to1BomRows",
      },
      {
        name: "MASTER",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "indirect RM cost fallback — value / quantity on the newest supply row",
        file: "lib/gmdBomCostLookup.ts:buildRmCostMap",
      },
    ],
    sync: QUOTATION_COST_SYNC,
  },
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard — enquiries, items & stock",
    sheetName: "",
    purpose:
      "The enquiry and line-item records themselves, plus the RM stock and delivery schedule copied onto them. Pure CRUD plus derived fields.",
    dbOnly: true,
    tabs: [],
    sync: QUOTATION_CRUD_SYNC,
  },
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard — seed data & cost tables",
    sheetName: "",
    purpose:
      "Every dropdown list and all six cost tables the cost engine reads. Hard-coded in scripts, never read from a spreadsheet.",
    dbOnly: true,
    tabs: [],
    sync: QUOTATION_SEED_SYNC,
  },
  {
    page: "Quotation Dashboard",
    route: "/",
    dashboardName: "Quotation Dashboard — maintenance scripts",
    sheetName: "GMD ERP Master + BOM MAST ERP + VERIFY BOM",
    purpose:
      "Bulk and one-time repair scripts for codes, costs, rates and the derived descriptive columns.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      {
        name: "GMD Item Creation Form",
        gid: "2142407502",
        headerRow: 1,
        resolvedBy: "gid",
        note: "item codes, DIRECT M2M and 2:1 recipes",
        file: "scripts/refresh-item-codes.ts, update-product-cost-from-bom.ts, update-2to1-cost-from-bom.ts",
      },
      {
        name: "BOM MAST ERP",
        gid: "1180547059",
        headerRow: 1,
        resolvedBy: "gid",
        note: "no-use / batch C signal behind backfill-available-bom-ids and remove-no-use-bom-ids",
        file: "lib/gmd_lib/bomMastErp.ts:readBomMastErp",
      },
    ],
    sync: QUOTATION_SCRIPT_SYNC,
  },
  {
    page: "Raw Material",
    route: "/raw_material",
    dashboardName: "Raw Material Dashboard",
    sheetName: "GMD UPDATION (Raw Material)",
    purpose:
      "Edits the GMD UPDATION sheet (item catalogue). The NON CHAIN BOM and MRP/IS tabs are checked by fetchSheetMetadata, which currently has no callers.",
    sheetId: GMD_ERP_MASTER_ID,
    tabs: [
      {
        name: "GMD UPDATION",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "main data — throws if the tab is renamed",
        file: "lib/gmd_lib/google-sheets.ts:fetchGMDUpdateSheet",
      },
      {
        name: "GMD Category",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "dropdown helper — returns {} if renamed",
        file: "lib/gmd_lib/google-sheets.ts:fetchGMDCategorySheet",
      },
      {
        name: "stock-phys",
        headerRow: 2,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "physical stock merge — header is on row 2",
        file: "lib/gmd_lib/google-sheets.ts:fetchStockPhysicalSheet",
      },
      {
        name: "NON CHAIN BOM",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "presence check only — no runtime caller",
        file: "lib/gmd_lib/google-sheets.ts:fetchSheetMetadata (unused)",
      },
      {
        name: "MRP/IS",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "presence check only — no runtime caller",
        file: "lib/gmd_lib/google-sheets.ts:fetchSheetMetadata (unused)",
      },
    ],
    sync: RAW_MATERIAL_SYNC,
  },
  {
    page: "Supply History",
    route: "/supply_history",
    dashboardName: "Supply History Dashboard",
    sheetName: "Supply History",
    sheetId: SUPPLY_HISTORY_ID,
    tabs: [
      {
        name: "MASTER",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "title",
        file: "app/api/supply-history/sync/route.ts",
      },
    ],
    sync: SUPPLY_HISTORY_SYNC,
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
        resolvedBy: "gid",
        note: "PO NO / ATTACH columns — superseded, no runtime caller",
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
        resolvedBy: "gid",
        note: "fallbacks CONTRACTS / GMD CLIENTWISE, then the first sheet",
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
      {
        name: "CONTRACTS",
        gid: "734728893",
        headerRow: 4,
        range: "A:ZZZ",
        resolvedBy: "gid",
        file: "app/api/contract-review/sync/route.ts",
      },
      {
        name: "DUMP",
        gid: "1604813523",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "gid",
        file: "app/api/contract-review/sync/route.ts",
      },
    ],
    sync: CONTRACT_REVIEW_SYNC,
  },
  {
    page: "Contract Review",
    route: "/contract_review",
    dashboardName: "Contract Review Dashboard (gap-fill seed)",
    sheetName: "BOM MAST ERP",
    purpose:
      "One-time gap-fill seed for ContractReview. Fills only fields that are blank in the DB; never overwrites. Does not write syncedAt, so it does not re-sort the page.",
    sheetId: BOM_MAST_ERP_ID,
    envVar: "CR_CONTRACT_DUMP_SPREADSHEET_ID",
    tabs: [
      {
        name: "CONTRACT DUMP",
        gid: "1279116711",
        headerRow: 1,
        range: "A:AF",
        resolvedBy: "gid",
        note: "one-time seed; 28/32 columns map (CONTRACT DATE -> dateOfContract alias)",
        file: "scripts/backfill-contract-review-contract-dump.ts",
      },
    ],
  },
  {
    page: "Cross-page (no page)",
    dashboardName: "C Batch sync — shared by 4 tables",
    sheetName: "BOM MAST ERP",
    purpose:
      "ITEM MASTER ERP (ITEM_CODE + ITEM_STATUS). The 'Sync C Batch' button marks cBatch='C' on every row whose code has ITEM_STATUS='C'. Set-only, never clears, and does not touch /bom (which uses the TO_DATE signal).",
    sheetId: BOM_MAST_ERP_ID,
    tabs: [
      {
        name: "ITEM MASTER ERP",
        gid: "253020709",
        headerRow: 1,
        range: "A1:ZZZ",
        resolvedBy: "gid",
        note: "ITEM_CODE -> ITEM_STATUS ('C' = 4279 of 22252 codes)",
        file: "lib/gmd_lib/bomMastErp.ts:readItemMasterErp",
      },
      {
        name: "BOM MAST ERP",
        gid: "1180547059",
        headerRow: 1,
        range: "A1:ZZZ",
        resolvedBy: "gid",
        note: "separate TO_DATE -> NO USE + batch C flow; drives the /bom page only",
        file: "app/actions.ts:syncBomMastItemNamesAction",
      },
    ],
  },
  {
    page: "Contract Review",
    route: "/contract_review",
    dashboardName: "Contract Review (INSPECTION OFFER DUMP)",
    sheetName: "BOM MAST ERP",
    purpose:
      "INSPECTION OFFER DUMP. Unions offerNumber / inspectionNumber / diDate into ContractReview, matched on MC No + Item Code. Replaced the old 'IC DUMP' tab in the Contract Review workbook, which had no shared key with the new sheet.",
    sheetId: BOM_MAST_ERP_ID,
    tabs: [
      {
        name: "INSPECTION OFFER DUMP",
        gid: "148043829",
        headerRow: 1,
        range: "A:ZZZ",
        resolvedBy: "gid",
        note: "positional mapping A=VRNO, C=ITEM_CODE, G=CONTRACT_VRNO, H=INSPE_VRNO, K=DI_DATE; asserted against these header names at startup so a shifted column aborts the run",
        file: "scripts/sync-ic-dump.ts",
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
      {
        name: "VERIFY BOM",
        headerRow: 2,
        range: "A2:ZZZ",
        resolvedBy: "title",
        note: "start row 2 is hard-coded; only the column binding inside A:ZZZ is dynamic, by normalised name",
        file: "app/api/bom/sync/route.ts",
      },
      {
        name: "GMD Item Creation Form",
        gid: "2142407502",
        headerRow: 1,
        resolvedBy: "gid",
        note: "metadata sync",
        file: "app/api/bom/sync-meta/route.ts",
      },
      {
        name: "stock-phys",
        headerRow: 2,
        range: "A:ZZZ",
        resolvedBy: "title",
        note: "available stock gap-fill",
        file: "syncNullVerifyBomStockAction (app/actions.ts:4435)",
      },
    ],
    sync: BOM_SYNC,
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
    purpose:
      "Optional second source of supply rows, upserted into SupplyHistoryItem by scripts/import-sale-bill.ts.",
    envVar: "SALE_BILL_SPREADSHEET_ID",
    tabs: [{ name: "GID 0", gid: "0", resolvedBy: "gid" }],
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

/** Total number of sync/script operations across the registry. */
export function countSyncOperations(sources = DATA_SOURCES): number {
  return sources.reduce((total, source) => total + (source.sync?.length ?? 0), 0);
}

/** Sources that carry at least one operation, in registry order. */
export function sourcesWithSync(
  sources = DATA_SOURCES,
): DataSource[] {
  return sources.filter((source) => (source.sync?.length ?? 0) > 0);
}