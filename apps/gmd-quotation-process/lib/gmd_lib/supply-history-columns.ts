import { C_BATCH_HEADER } from "./verify-bom-columns";

export const SUPPLY_HISTORY_HEADERS = [
  "item name",
  "INVOICE NO",
  "FINANCIAL YEAR",
  "party name",
  "ERP PARTY NAME",
  "Date",
  "PARTY Order No.",
  "PARTY Date",
  "Quantity",
  "UOM",
  "Value",
  "Gross Total- INVOICE VALUE",
  "LR NO & DT",
  "DELIVERY DESTINATION",
  "CONSIGNEE ADDRESS",
  "CONSIGNEE NAME",
  "ERP CONTRACT NO",
  "ERP ITEM CODE",
  "TYPE OF VALVE",
  "SIZE OF VALVE",
  "CLASS OF VALVE",
  "SPARES (TYPE)",
  "MOC",
  "ORDER COPY",
  "INVOICE",
  "INSPECTION REPORT",
  "State",
  "UTILITY",
  "performance certificate",
  "service period complete",
  "WARRANTY VALID TILL AS PER CONTRACT",
  "Warranty valid/Not",
  "BG NO",
  "PBG VALID TILL",
  "as per order warranty period",
  "PBG CLAIM TILL",
  "PBG AMOUNT",
  "Warranty Exp Date as Per Inv",
  "Party Mail Address",
  "Item Type",
  "MOC",
  "Size",
  "ORDER LIST",
  // Hidden data carrier. Never rendered: listed in the route's DISPLAY_HEADERS
  // and the page's hiddenColumns, and only used to drive the "C" chip inside the
  // ERP ITEM CODE cell.
  C_BATCH_HEADER,
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

export function buildColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const canonical = SUPPLY_HISTORY_HEADERS.map(normalizeHeader);
  const used = new Set<number>();
  return canonical.map((col) => {
    for (let i = 0; i < normalized.length; i++) {
      if (!used.has(i) && normalized[i] === col) {
        used.add(i);
        return i;
      }
    }
    return -1;
  });
}

export function mapSheetRowToDb(
  row: unknown[],
  columnMap: number[],
  syncedAt: Date,
) {
  const getVal = (canonicalIdx: number): string | null => {
    const sheetIdx = columnMap[canonicalIdx];
    if (sheetIdx < 0) return null;
    const v = row[sheetIdx];
    return v != null && v !== "" ? String(v) : null;
  };
  const getRequired = (canonicalIdx: number): string => {
    const sheetIdx = columnMap[canonicalIdx];
    return String(row[sheetIdx] ?? "");
  };

  return {
    itemName:        getRequired(0),
    invoiceNo:       getRequired(1),
    financialYear:   getVal(2),
    partyName:       getVal(3),
    erpPartyName:    getVal(4),
    date:            getVal(5),
    partyOrderNo:    getVal(6),
    partyDate:       getVal(7),
    quantity:        getVal(8),
    uom:             getVal(9),
    value:           getVal(10),
    grossTotalInvoiceValue: getVal(11),
    lrNoDt:          getVal(12),
    deliveryDestination:    getVal(13),
    consigneeAddress:       getVal(14),
    consigneeName:          getVal(15),
    erpContractNo:   getVal(16),
    erpItemCode:     getVal(17),
    typeOfValve:     getVal(18),
    sizeOfValve:     getVal(19),
    classOfValve:    getVal(20),
    sparesType:      getVal(21),
    moc:             getVal(22),
    orderCopy:       getVal(23),
    invoice:         getVal(24),
    inspectionReport: getVal(25),
    state:           getVal(26),
    utility:         getVal(27),
    performanceCertificate: getVal(28),
    servicePeriodComplete:   getVal(29),
    warrantyValidTillAsPerContract: getVal(30),
    warrantyValidNot: getVal(31),
    bgNo:            getVal(32),
    pbgValidTill:    getVal(33),
    asPerOrderWarrantyPeriod: getVal(34),
    pbgClaimTill:    getVal(35),
    pbgAmount:       getVal(36),
    warrantyExpDateAsPerInv:   getVal(37),
    partyMailAddress: getVal(38),
    orderList:        null as string | null,
    syncedAt,
  };
}

export const SUPPLY_HEADER_TO_DB_FIELD: Record<string, string> = {
  "Party Mail Address": "partyMailAddress",
  "Item Type": "derivedItemType",
  "MOC": "derivedMoc",
  "Size": "derivedSize",
  "State": "state",
  "UTILITY": "utility",
};

export function dbItemToRow(item: {
  financialYear: string | null;
  partyName: string | null;
  erpPartyName: string | null;
  itemName: string | null;
  invoiceNo: string | null;
  date: string | null;
  partyOrderNo: string | null;
  partyDate: string | null;
  quantity: string | null;
  uom: string | null;
  value: string | null;
  grossTotalInvoiceValue: string | null;
  lrNoDt: string | null;
  deliveryDestination: string | null;
  consigneeAddress: string | null;
  consigneeName: string | null;
  erpContractNo: string | null;
  erpItemCode: string | null;
  typeOfValve: string | null;
  sizeOfValve: string | null;
  classOfValve: string | null;
  sparesType: string | null;
  moc: string | null;
  orderCopy: string | null;
  invoice: string | null;
  inspectionReport: string | null;
  state: string | null;
  utility: string | null;
  performanceCertificate: string | null;
  servicePeriodComplete: string | null;
  warrantyValidTillAsPerContract: string | null;
  warrantyValidNot: string | null;
  bgNo: string | null;
  pbgValidTill: string | null;
  asPerOrderWarrantyPeriod: string | null;
  pbgClaimTill: string | null;
  pbgAmount: string | null;
  warrantyExpDateAsPerInv: string | null;
  partyMailAddress: string | null;
  orderList: string | null;
  derivedItemType: string | null;
  derivedMoc: string | null;
  derivedSize: string | null;
  cBatch: string | null;
}): unknown[] {
  return [
    item.itemName, item.invoiceNo, item.financialYear,
    item.partyName, item.erpPartyName, item.date,
    item.partyOrderNo, item.partyDate, item.quantity,
    item.uom, item.value, item.grossTotalInvoiceValue,
    item.lrNoDt, item.deliveryDestination, item.consigneeAddress,
    item.consigneeName, item.erpContractNo, item.erpItemCode,
    item.typeOfValve, item.sizeOfValve, item.classOfValve,
    item.sparesType, item.moc, item.orderCopy,
    item.invoice, item.inspectionReport, item.state,
    item.utility, item.performanceCertificate, item.servicePeriodComplete,
    item.warrantyValidTillAsPerContract, item.warrantyValidNot,
    item.bgNo, item.pbgValidTill, item.asPerOrderWarrantyPeriod,
    item.pbgClaimTill, item.pbgAmount, item.warrantyExpDateAsPerInv,
    item.partyMailAddress,
    item.derivedItemType, item.derivedMoc, item.derivedSize,
    item.orderList,
    item.cBatch,
  ];
}
