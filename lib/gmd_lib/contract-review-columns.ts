export const CONTRACT_REVIEW_HEADERS = [
  "CONTRACT NO",
  "DATE OF CONTRACT",
  "PARTY NAME",
  "ITEM_CODE",
  "MC NO",
  "PO NO",
  "ITEM_NAME",
  "PARTY ITEM NAME",
  "RATE",
  "VALUE",
  "VA % FROM COST",
  "COST FROM QUOTATION",
  "CV",
  "VA %",
  "ORDER QTY",
  "FREE STOCK",
  "FINAL REQ",
  "MC QTY",
  "Balance mc",
  "PROD ORD QTY",
  "BALANCE TO PROD ORD",
  "BALANCE TO PROD ENT",
  "DI QTY",
  "BILLED QTY",
  "BAL BILL AG CONT",
  "BAL DI QTY",
  "BAL MC VAL",
  "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL",
  "BAL BILL AG CONT VAL",
  "BAL BILL AG MC VAL",
  "BAL DI VAL",
  "DI VAL",
  "Item",
  "SIZE",
  "PN RATING",
  "CLEARANCE STATUS",
  "Actuator",
  "RM CODE FOR ACTUATOR",
  "RM CODE FOR GB",
  "PAYMENT TERMS",
  "LC/RTGS REF NO",
  "LC DATE/RTGS DATE",
  "LAST DATE OF SHIPMENT/DATE OF LC",
  "Issuing bank name",
  "bom formula trial",
  "ITEM TYPE",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
  "JOB Code",
  "BAL BILL AG MC",
  "ic qty",
  "BOM ID",
  "RM AVAIL",
  "STATUS",
  "MC Received/Pending",
  "Inspection",
  "OFFER PENDING/DONE",
  "Remarks",
  "STATE",
  "UTILITY",
  "PROJECT REFERENCE",
  "OFFER NUMBER",
  "INSPECTION NUMBER",
  "DI DATE",
  "ORDER LIST",
  "PROD ORDER NO",
  "Upload Drawing",
] as const;

/**
 * Default rendered width, in px, for each column on the Contract Review
 * dashboard. Sizes are driven by the widest of the two things a cell can hold:
 * the truncated header caption, or the value.
 *
 * Only the standalone columns need an entry here — the 5 collapsed groups are
 * sized by `width` on CONTRACT_REVIEW_COLUMN_GROUPS below, which takes
 * precedence. Any header missing from this map (or renamed on the sheet, which
 * makes the API's header string stop matching) falls back to the generic
 * default in GMDUpdateTable.
 *
 * Keyed by header so widths survive column reordering, and typed against the
 * header union so a typo is a compile error rather than a silent fallback.
 */
export const CONTRACT_REVIEW_COLUMN_WIDTHS: Partial<
  Record<(typeof CONTRACT_REVIEW_HEADERS)[number], number>
> = {
  // Dates.
  "DATE OF CONTRACT": 150,
  "DI DATE": 150,

  // Short codes / identifiers.
  "MC NO": 110,
  "ic qty": 100,
  "ITEM_CODE": 130,
  "JOB Code": 120,
  "BOM ID": 130,
  "RM CODE FOR GB": 130,
  "PROD ORDER NO": 150,
  "OFFER NUMBER": 140,
  "INSPECTION NUMBER": 150,

  // Plain numeric values: the value is short, the caption is not.
  "CV": 100,
  "VA %": 80,
  RATE: 90,
  "ORDER QTY": 100,
  "FREE STOCK": 110,
  "FINAL REQ": 110,
  "MC QTY": 110,
  "DI QTY": 110,
  "DI VAL": 110,
  "RM AVAIL": 110,
  "BAL DI VAL": 120,
  "BAL MC VAL": 120,
  VALUE: 95,
  "Balance mc": 120,
  "PROD ORD QTY": 120,
  "BILLED QTY": 120,
  "BAL DI QTY": 120,
  "STATE": 110,
  "UTILITY": 110,
  "ITEM TYPE": 120,
  "VA % FROM COST": 100,
  "COST FROM QUOTATION": 150,
  // Caption-driven: these columns are wide purely because the header is.
  "BAL BILL AG CONT": 100,
  "BAL BILL AG MC": 140,
  "BAL PROD ORD VAL": 145,
  "BALANCE TO PROD ORD": 150,
  "BALANCE TO PROD ENT": 150,
  "BAL BILL AG MC VAL": 155,
  "BAL BILL AG CONT VAL": 160,
  "BAL TO PROD ORD ENT VAL": 165,

  // Status / medium free text.
  STATUS: 140,
  Inspection: 140,
  "CLEARANCE STATUS": 130,
  "OFFER PENDING/DONE": 150,
  "MC Received/Pending": 160,
  "ORDER LIST": 160,
  "PAYMENT TERMS": 180,
  "PROJECT REFERENCE": 200,
  "Upload Drawing": 100,
  Remarks: 220,

  // Long free text.
  "PARTY NAME": 240,
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY": 280,
  "bom formula trial": 300,
};

/**
 * Columns collapsed into a single parent column in the UI, mirroring the
 * grouped columns on the Quotation Process page.
 *
 * A group always renders at the position of its first *visible* child in
 * CONTRACT_REVIEW_HEADERS, so visual order follows the header array, not the
 * order groups are listed here. Declared in visual order for readability:
 *   Contract/PO (idx 0) -> Item Names (idx 6) -> Item/Size/PN (idx 33) ->
 *   Actuator (idx 36) -> LC/RTGS/Bank (idx 39)
 *
 * These are purely a display concern: the headers array, the row serializer and
 * the header->DB field map are all untouched, so every *IDX constant and all
 * inline edits keep working.
 */
export const CONTRACT_REVIEW_COLUMN_GROUPS = [
  {
    label: "Contract / PO NO",
    width: 175,
    children: [
      { header: "CONTRACT NO", label: "Contract NO" },
      { header: "PO NO", label: "PO NO" },
    ],
  },
  {
    label: "Item Names/Party Item Names",
    width: 200,
    children: [
      { header: "ITEM_NAME", label: "Item Name -" },
      { header: "PARTY ITEM NAME", label: "Party Item Name -" },
    ],
  },
  {
    label: "Item / Size / PN RATING",
    width: 185,
    children: [
      { header: "Item", label: "Item -" },
      { header: "SIZE", label: "Size -" },
      { header: "PN RATING", label: "PN Rating -" },
    ],
  },
  {
    label: "Actuator / RM Code for Actuator",
    width: 185,
    children: [
      { header: "Actuator", label: "Actuator" },
      { header: "RM CODE FOR ACTUATOR", label: "RM Code for Actuator" },
    ],
  },
  {
    label: "LC / RTGS / Issuing bank name",
    width: 420,
    children: [
      { header: "LC/RTGS REF NO", label: " LC/RTGSRef No -" },
      { header: "LC DATE/RTGS DATE", label: "LC Date -" },
      {
        header: "LAST DATE OF SHIPMENT/DATE OF LC",
        label: "Ship Date Of LC -",
      },
      { header: "Issuing bank name", label: "Issuing Bank Name -" },
    ],
  },
];

export const CONTRACTS_SHEET_COLUMNS = [
  "CONTRACT NO",
  "ITEM_CODE",
  "MC NO",
  "ITEM_NAME",
  "PARTY ITEM NAME",
  "RATE",
  "CV",
  "VA %",
  "ORDER QTY",
  "FREE STOCK",
  "FINAL REQ",
  "MC QTY",
  "Balance mc",
  "PROD ORD QTY",
  "BALANCE TO PROD ORD",
  "BALANCE TO PROD ENT",
  "DI QTY",
  "BILLED QTY",
  "BAL BILL AG MC",
  "BAL BILL AG CONT",
  "Item",
  "VALUE",
  "SIZE",
  "PN RATING",
  "DATE OF CONTRACT",
  "CLEARANCE STATUS",
  "Actuator",
  "RM CODE FOR ACTUATOR",
  "RM CODE FOR GB",
  "PAYMENT TERMS",
  "LC/RTGS REF NO",
  "LC DATE/RTGS DATE",
  "LAST DATE OF SHIPMENT/DATE OF LC",
  "Issuing bank name",
  "bom formula trial",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
  "BOM NATURE",
  "STATUS",
] as const;

export const DUMP_SHEET_COLUMNS = [
  "JOB Code",
  "BAL DI QTY",
  "BAL MC VAL",
  "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL",
  "BAL BILL AG MC VAL",
  "BAL BILL AG CONT VAL",
  "BAL DI VAL",
  "DI VAL",
  "ic qty",
  "BAL BILL AG MC",
  "DI QTY",
  "MC QTY",
  "BILLED QTY",
  "ORDER QTY",
  "PARTY NAME",
] as const;

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function buildContractsColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const map = CONTRACTS_SHEET_COLUMNS.map((col) => {
    const target = normalizeHeader(col);
    return normalized.lastIndexOf(target);
  });
  assertNoCollision(map, CONTRACTS_SHEET_COLUMNS);
  return map;
}

export function buildDumpColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const map = DUMP_SHEET_COLUMNS.map((col) => {
    const target = normalizeHeader(col);
    return normalized.findIndex((h) => h === target);
  });
  assertNoCollision(map, DUMP_SHEET_COLUMNS);
  return map;
}

function assertNoCollision(
  map: number[],
  cols: readonly string[],
): void {
  const seen = new Map<number, string>();
  for (let i = 0; i < map.length; i++) {
    const idx = map[i];
    if (idx < 0) continue;
    const prev = seen.get(idx);
    if (prev !== undefined) {
      throw new Error(
        `Column collision: "${prev}" and "${cols[i]}" both map to sheet index ${idx}. ` +
          `Refusing to interchange data. Check sheet headers for exact/duplicate column names.`,
      );
    }
    seen.set(idx, cols[i]);
  }
}

export function mapContractReviewRow(
  contractRow: unknown[],
  dumpRow: unknown[] | null,
  contractsColumnMap: number[],
  dumpColumnMap: number[],
) {
  const getVal = (row: unknown[], sheetIdx: number): string | null => {
    if (sheetIdx < 0) return null;
    const v = row[sheetIdx];
    return v != null && v !== "" ? String(v).trim() : null;
  };

  const field = (
    canonicalIdx: number,
  ): string | null => getVal(contractRow, contractsColumnMap[canonicalIdx]);

  const itemTypeVal = field(36);

  const dumpVal = (
    name: (typeof DUMP_SHEET_COLUMNS)[number],
  ): string | null => {
    const idx = dumpColumnMap[DUMP_SHEET_COLUMNS.indexOf(name)];
    return dumpRow ? getVal(dumpRow, idx) : null;
  };

  return {
    contractNo: field(0) ?? "",
    itemCode: field(1) ?? "",
    mcNo: field(2),
    itemName: field(3),
    partyItemName: field(4),
    rate: field(5),
    cv: field(6),
    vaPercent: field(7),
    orderQty: field(8) ?? dumpVal("ORDER QTY"),
    freeStock: field(9),
    finalReq: field(10),
    mcQty: field(11) ?? dumpVal("MC QTY"),
    balanceMc: field(12),
    prodOrdQty: field(13),
    balanceToProdOrd: field(14),
    balanceToProdEnt: field(15),
    diQty: field(16) ?? dumpVal("DI QTY"),
    billedQty: field(17) ?? dumpVal("BILLED QTY"),
    balBillAgCont: field(19),
    item: field(20),
    value: field(21),
    size: field(22),
    pnRating: field(23),
    dateOfContract: field(24),
    clearanceStatus: field(25),
    actuator: field(26),
    rmCodeForActuator: field(27),
    rmCodeForGb: field(28),
    paymentTerms: field(29),
    lcRtgsRefNo: field(30),
    lcDateRtgsDate: field(31),
    lastDateOfShipmentDateOfLc: field(32),
    issuingBankName: field(33),
    bomFormulaTrial: field(34),
    erpPartyNameFromGmdSupplyHistory: field(35),
    itemType: itemTypeVal,
    jobCode: dumpRow ? getVal(dumpRow, dumpColumnMap[0]) : null,
    balBillAgMc: dumpRow ? getVal(dumpRow, dumpColumnMap[10]) : null,
    balDiQty: dumpRow ? getVal(dumpRow, dumpColumnMap[1]) : null,
    balMcVal: dumpRow ? getVal(dumpRow, dumpColumnMap[2]) : null,
    balProdOrdVal: dumpRow ? getVal(dumpRow, dumpColumnMap[3]) : null,
    balToProdOrdEntVal: dumpRow ? getVal(dumpRow, dumpColumnMap[4]) : null,
    balBillAgMcVal: dumpRow ? getVal(dumpRow, dumpColumnMap[5]) : null,
    balBillAgContVal: dumpRow ? getVal(dumpRow, dumpColumnMap[6]) : null,
    balDiVal: dumpRow ? getVal(dumpRow, dumpColumnMap[7]) : null,
    diVal: dumpRow ? getVal(dumpRow, dumpColumnMap[8]) : null,
    icQty: dumpRow ? getVal(dumpRow, dumpColumnMap[9]) : null,
    partyNameDump: dumpRow
      ? getVal(dumpRow, dumpColumnMap[DUMP_SHEET_COLUMNS.indexOf("PARTY NAME")])
      : null,
    status: field(37),
  };
}

export function dbContractReviewToRow(item: {
  contractNo: string | null;
  itemCode: string | null;
  mcNo: string | null;
  itemName: string | null;
  partyItemName: string | null;
  rate: string | null;
  cv: string | null;
  vaPercent: string | null;
  orderQty: string | null;
  freeStock: string | null;
  finalReq: string | null;
  mcQty: string | null;
  balanceMc: string | null;
  prodOrdQty: string | null;
  balanceToProdOrd: string | null;
  balanceToProdEnt: string | null;
  diQty: string | null;
  billedQty: string | null;
  balBillAgCont: string | null;
  balDiQty: string | null;
  balMcVal: string | null;
  balProdOrdVal: string | null;
  balToProdOrdEntVal: string | null;
  balBillAgContVal: string | null;
  balBillAgMcVal: string | null;
  balDiVal: string | null;
  diVal: string | null;
  item: string | null;
  value: string | null;
  size: string | null;
  pnRating: string | null;
  dateOfContract: string | null;
  clearanceStatus: string | null;
  actuator: string | null;
  itemType: string | null;
  rmCodeForActuator: string | null;
  rmCodeForGb: string | null;
  paymentTerms: string | null;
  lcRtgsRefNo: string | null;
  lcDateRtgsDate: string | null;
  lastDateOfShipmentDateOfLc: string | null;
  issuingBankName: string | null;
  bomFormulaTrial: string | null;
  erpPartyNameFromGmdSupplyHistory: string | null;
  jobCode: string | null;
  balBillAgMc: string | null;
  icQty: string | null;
  bomId: string | null;
  noUse: string | null;
  partyNameDump: string | null;
  status: string | null;
  mcReceivedPending: string | null;
  inspection: string | null;
  offerPendingDone: string | null;
  remarks: string | null;
  state: string | null;
  utility: string | null;
  projectReference: string | null;
  offerNumber: string[] | null;
  inspectionNumber: string[] | null;
  diDate: string[] | null;
  orderList: string[] | null;
  poNo: string | null;
  costfromQuotation: string | null;
  vaPercentfromcost: string | null;
  productionOrderNumber: string | null;
  diagramUrl: string | null;
}): unknown[] {
  return [
    item.contractNo,
    item.dateOfContract,
    item.partyNameDump,
    item.itemCode, item.mcNo, item.poNo,
    item.itemName, item.partyItemName, item.rate,
    item.value,
    item.vaPercentfromcost,
    item.costfromQuotation,
    item.cv, item.vaPercent,
    item.orderQty,
    item.freeStock, item.finalReq, item.mcQty,
    item.balanceMc,
    item.prodOrdQty, item.balanceToProdOrd, item.balanceToProdEnt,
    item.diQty, item.billedQty,
    item.balBillAgCont,
    item.balDiQty, item.balMcVal, item.balProdOrdVal,
    item.balToProdOrdEntVal, item.balBillAgContVal, item.balBillAgMcVal,
    item.balDiVal, item.diVal,
    item.item, item.size, item.pnRating,
    item.clearanceStatus, item.actuator,
    item.rmCodeForActuator, item.rmCodeForGb, item.paymentTerms,
    item.lcRtgsRefNo, item.lcDateRtgsDate, item.lastDateOfShipmentDateOfLc,
    item.issuingBankName, item.bomFormulaTrial,
    item.itemType,
    item.erpPartyNameFromGmdSupplyHistory,
    item.jobCode, item.balBillAgMc, item.icQty,
    item.bomId,
    item.noUse,
    item.status,
    item.mcReceivedPending,
    item.inspection,
    item.offerPendingDone,
    item.remarks,
    item.state,
    item.utility,
    item.projectReference,
    (item.offerNumber ?? []).join(", "),
    (item.inspectionNumber ?? []).join(", "),
    (item.diDate ?? []).join(", "),
    (item.orderList ?? []).join(", "),
    item.productionOrderNumber,
    item.diagramUrl,
  ];
}

export const CONTRACT_REVIEW_HEADER_TO_DB_FIELD: Record<string, string> = {
  "CONTRACT NO": "contractNo",
  "PARTY NAME": "partyNameDump",
  "MC NO": "mcNo",
  "PO NO": "poNo",
  "ITEM_CODE": "itemCode",
  "ITEM_NAME": "itemName",
  "PARTY ITEM NAME": "partyItemName",
  "RATE": "rate",
  "VA % FROM COST": "vaPercentfromcost",
  "COST FROM QUOTATION": "costfromQuotation",
  "CV": "cv",
  "VA %": "vaPercent",
  "ORDER QTY": "orderQty",
  "FREE STOCK": "freeStock",
  "FINAL REQ": "finalReq",
  "MC QTY": "mcQty",
  "Balance mc": "balanceMc",
  "PROD ORD QTY": "prodOrdQty",
  "BALANCE TO PROD ORD": "balanceToProdOrd",
  "BALANCE TO PROD ENT": "balanceToProdEnt",
  "DI QTY": "diQty",
  "BILLED QTY": "billedQty",
  "BAL BILL AG MC": "balBillAgMc",
  "BAL BILL AG CONT": "balBillAgCont",
  "Item": "item",
  "VALUE": "value",
  "SIZE": "size",
  "PN RATING": "pnRating",
  "DATE OF CONTRACT": "dateOfContract",
  "CLEARANCE STATUS": "clearanceStatus",
  "Actuator": "actuator",
  "RM CODE FOR ACTUATOR": "rmCodeForActuator",
  "RM CODE FOR GB": "rmCodeForGb",
  "PAYMENT TERMS": "paymentTerms",
  "LC/RTGS REF NO": "lcRtgsRefNo",
  "LC DATE/RTGS DATE": "lcDateRtgsDate",
  "LAST DATE OF SHIPMENT/DATE OF LC": "lastDateOfShipmentDateOfLc",
  "Issuing bank name": "issuingBankName",
  "bom formula trial": "bomFormulaTrial",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY": "erpPartyNameFromGmdSupplyHistory",
  "ITEM TYPE": "itemType",
  "JOB Code": "jobCode",
  "BAL DI QTY": "balDiQty",
  "BAL MC VAL": "balMcVal",
  "BAL PROD ORD VAL": "balProdOrdVal",
  "BAL TO PROD ORD ENT VAL": "balToProdOrdEntVal",
  "BAL BILL AG MC VAL": "balBillAgMcVal",
  "BAL BILL AG CONT VAL": "balBillAgContVal",
  "BAL DI VAL": "balDiVal",
  "DI VAL": "diVal",
  "ic qty": "icQty",
  "BOM ID": "bomId",
  "RM AVAIL": "noUse",
  "STATUS": "status",
  "MC Received/Pending": "mcReceivedPending",
  "Inspection": "inspection",
  "OFFER PENDING/DONE": "offerPendingDone",
  "Remarks": "remarks",
  "ORDER LIST": "orderList",
  "PROD ORDER NO": "productionOrderNumber",
  "Upload Drawing": "diagramUrl",
};
