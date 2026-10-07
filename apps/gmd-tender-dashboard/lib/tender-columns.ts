import { parseDate } from "@/lib/parse-date";

const MERGED_FIELDS = new Set([
  "advisoryBank",
  "aiRelevanceReason",
  "aiRelevanceValid",
  "apm",
  "app",
  "aps",
  "arbitrationClause",
  "assignedTo",
  "attachmentUrl",
  "beneficiaryBankDetails",
  "bgDate",
  "bgExpiryDate",
  "bgNoUtrNo",
  "bgStatus",
  "bidDetails",
  "bidOfferValidity",
  "bidOpeningDateTime",
  "bidStatus",
  "bidToRaEnabled",
  "bidValidityDays",
  "bidValidityExpired",
  "boqTitle",
  "checklist",
  "claimDate",
  "competitors",
  "comprehensiveMaintenanceChargesRequired",
  "consigneesReportingOfficer",
  "contractNo",
  "contractPeriod",
  "contractPeriodDays",
  "currency",
  "currentStatus",
  "cva",
  "deadline",
  "departmentName",
  "differenceBetweenRank1",
  "differenceBetweenRank2",
  "diffL1ManuallyEdited",
  "diffL2ManuallyEdited",
  "diffPercentFromL1",
  "diffPercentFromL2",
  "docketNo",
  "documentFees",
  "documentRequiredFromSeller",
  "downloadLink",
  "emd",
  "emdPaymentMode",
  "emdValidity",
  "ePbgDurationMonths",
  "ePbgPercentage",
  "estimatedBidValue",
  "evaluationMethod",
  "evaluationTableData",
  "excludedCategory",
  "expectedRaDate",
  "finalRemarks",
  "financialDocumentPriceBreakupRequired",
  "inspectionRequired",
  "itemCategory",
  "location",
  "locationCount",
  "loiPoNoAndDate",
  "markedStatus",
  "mediationClause",
  "miiPurchasePreference",
  "minimumAverageAnnualTurnover",
  "ministryStateName",
  "msePurchasePreference",
  "msmeExemption",
  "nameOfRank1",
  "nameOfRank2",
  "nextAction",
  "oemAverageTurnover",
  "officeName",
  "organization",
  "ourRank",
  "ourValue",
  "parseError",
  "parseStatus",
  "participated",
  "pastExperienceSimilarServicesRequired",
  "pastPerformance",
  "price",
  "proposedErpItemName",
  "proposedErpQuantity",
  "quantity",
  "quotationNo",
  "raQualificationRule",
  "rawMaterials",
  "ready",
  "reason",
  "reasonForNotAPM",
  "remarks",
  "referenceNo",
  "resultAutomationError",
  "resultAutomationStatus",
  "reverseAuctionApplicable",
  "reverseAuctionDate",
  "scrapedDate",
  "searchKey",
  "sheetStatus",
  "similarCategory",
  "size",
  "slNo",
  "source",
  "startupExemption",
  "state",
  "statusCategory",
  "t247Id",
  "technicalClarificationTimeAllowed",
  "tenderBrief",
  "tenderFileUrl",
  "tenderFor",
  "tenderOpeningDate",
  "tenderUpdateStatus",
  "totalQuantity",
  "typeOfBid",
  "value",
  "valueOfRank1",
  "valueOfRank2",
  "website",
  "yearsOfPastExperience",
]);

type ColumnMap = Record<string, string>;

export const COLUMN_MAP: ColumnMap = {
  referenceNo: "referenceNo",
  deptTenderNumber: "referenceNo",
  actualTenderNumber: "referenceNo",

  tenderBrief: "tenderBrief",
  brief: "tenderBrief",
  tenderDescription: "tenderBrief",
  description: "tenderBrief",
  tenderDetails: "tenderBrief",
  workDescription: "tenderBrief",
  itemName: "tenderBrief",

  value: "value",
  tenderValue: "value",
  estimatedValue: "value",
  tenderValueInRs: "value",

  estimatedCost: "estimatedBidValue",

  deadline: "deadline",
  bidDeadline: "deadline",
  dueDate: "deadline",
  closingDate: "deadline",
  lastDate: "deadline",
  bidEndDate: "deadline",
  submissionDeadline: "deadline",
  bidSubmissionEndDate: "deadline",

  location: "location",
  placeOfWork: "location",
  workLocation: "location",
  region: "location",
  state: "location",
  city: "location",
  address: "location",
  country: "location",

  organization: "organization",
  procuringEntity: "organization",
  buyer: "organization",
  department: "organization",
  organisation: "organization",
  tenderAuthority: "organization",
  departmentName: "departmentName",
  officeName: "officeName",
  ministryStateName: "ministryStateName",

  documentFees: "documentFees",
  docFees: "documentFees",
  tenderFee: "documentFees",
  costOfDocument: "documentFees",
  tenderDocumentFees: "documentFees",

  emd: "emd",
  earnestMoney: "emd",
  bidSecurity: "emd",
  earnestMoneyDeposit: "emd",

  quantity: "quantity",
  size: "quantity",
  "quantity/size": "quantity",

  msmeExemption: "msmeExemption",
  startupExemption: "startupExemption",

  checklist: "checklist",
  requirementChecklist: "checklist",

  bidOpeningDateTime: "bidOpeningDateTime",
  bidOpeningDate: "bidOpeningDateTime",
  "Bid Opening Date/Time": "bidOpeningDateTime",
  bidOfferValidity: "bidOfferValidity",
  "Bid Offer Validity (From End Date)": "bidOfferValidity",

  minimumAverageAnnualTurnover: "minimumAverageAnnualTurnover",
  avgAnnualTurnover: "minimumAverageAnnualTurnover",
  averageTurnover: "minimumAverageAnnualTurnover",
  "Minimum Average Annual Turnover of the bidder": "minimumAverageAnnualTurnover",

  yearsOfPastExperience: "yearsOfPastExperience",
  pastExperience: "yearsOfPastExperience",
  "Years of Past Experience Required for same/similar service": "yearsOfPastExperience",

  oemAverageTurnover: "oemAverageTurnover",
  oemTurnover: "oemAverageTurnover",

  contractPeriod: "contractPeriod",
  periodOfContract: "contractPeriod",

  similarCategory: "similarCategory",

  typeOfBid: "typeOfBid",
  bidType: "typeOfBid",

  boqTitle: "boqTitle",

  bidDetails: "bidDetails",

  estimatedBidValue: "estimatedBidValue",
  tenderAmount: "estimatedBidValue",

  evaluationMethod: "evaluationMethod",

  advisoryBank: "advisoryBank",
  bank: "advisoryBank",

  ePbgPercentage: "ePbgPercentage",
  epbgPercentage: "ePbgPercentage",
  performanceBankGuarantee: "ePbgPercentage",

  ePbgDurationMonths: "ePbgDurationMonths",
  epbgDuration: "ePbgDurationMonths",

  inspectionRequired: "inspectionRequired",
  "Inspection Required (By Empanelled Inspection Authority / Agencies pre registered with GeM)": "inspectionRequired",

  pastPerformance: "pastPerformance",

  bidToRaEnabled: "bidToRaEnabled",
  raEnabled: "bidToRaEnabled",

  msePurchasePreference: "msePurchasePreference",
  msePreference: "msePurchasePreference",

  miiPurchasePreference: "miiPurchasePreference",
  miiPreference: "miiPurchasePreference",

  consigneesReportingOfficer: "consigneesReportingOfficer",
  reportingOfficer: "consigneesReportingOfficer",

  mediationClause: "mediationClause",
  arbitrationClause: "arbitrationClause",

  raQualificationRule: "raQualificationRule",

  comprehensiveMaintenanceChargesRequired: "comprehensiveMaintenanceChargesRequired",
  maintenanceCharges: "comprehensiveMaintenanceChargesRequired",

  technicalClarificationTimeAllowed: "technicalClarificationTimeAllowed",
  "Time allowed for Technical Clarifications during technical evaluation": "technicalClarificationTimeAllowed",

  financialDocumentPriceBreakupRequired: "financialDocumentPriceBreakupRequired",
  priceBreakupRequired: "financialDocumentPriceBreakupRequired",
  "Financial Document Indicating Price Breakup Required": "financialDocumentPriceBreakupRequired",
  documentRequiredFromSeller: "documentRequiredFromSeller",

  pastExperienceSimilarServicesRequired: "pastExperienceSimilarServicesRequired",
  "Past Experience of Similar Services": "pastExperienceSimilarServicesRequired",

  t247Id: "t247Id",
  tidNo: "t247Id",

  scrapedDate: "scrapedDate",
  publicationDate: "scrapedDate",

  source: "source",
  originalSource: "source",

  app: "app",
  aps: "aps",
  apm: "apm",

  assignedTo: "assignedTo",
  assignee: "assignedTo",
  assignedPerson: "assignedTo",
  assignedToName: "assignedTo",
  assigned: "assignedTo",
  "Assigned To": "assignedTo",

  markedStatus: "markedStatus",

  sheetStatus: "sheetStatus",

  ready: "ready",

  searchKey: "searchKey",
  tenderClassifiedIn: "searchKey",

  downloadLink: "downloadLink",

  currency: "currency",

  itemCategory: "itemCategory",
  itemcategory: "itemCategory",
  "Item Category": "itemCategory",

  totalQuantity: "totalQuantity",
  totalquantity: "totalQuantity",
  "Total Quantity": "totalQuantity",
  totalQty: "totalQuantity",
  totalqty: "totalQuantity",

  aiRelevanceValid: "aiRelevanceValid",
  aiRelevanceReason: "aiRelevanceReason",
  attachmentUrl: "attachmentUrl",
  "Attachment URL": "attachmentUrl",
  beneficiaryBankDetails: "beneficiaryBankDetails",
  "Beneficiary Bank Details": "beneficiaryBankDetails",
  bgDate: "bgDate",
  "BG Date": "bgDate",
  bgExpiryDate: "bgExpiryDate",
  "BG Expiry Date": "bgExpiryDate",
  bgNoUtrNo: "bgNoUtrNo",
  "BG No / UTR No": "bgNoUtrNo",
  bgStatus: "bgStatus",
  "BG Status": "bgStatus",
  bidStatus: "bidStatus",
  "Bid Status": "bidStatus",
  bidValidityDays: "bidValidityDays",
  "Bid Validity Days": "bidValidityDays",
  bidValidityExpired: "bidValidityExpired",
  claimDate: "claimDate",
  "Claim Date": "claimDate",
  competitors: "competitors",
  contractNo: "contractNo",
  "Contract No": "contractNo",
  contractPeriodDays: "contractPeriodDays",
  currentStatus: "currentStatus",
  "Current Status": "currentStatus",
  cva: "cva",
  docketNo: "docketNo",
  docketNumber: "docketNo",
  "Docket No": "docketNo",
  diffPercentFromL1: "diffPercentFromL1",
  "Diff % from L1": "diffPercentFromL1",
  diffPercentFromL2: "diffPercentFromL2",
  "Diff % from L2": "diffPercentFromL2",
  diffL1ManuallyEdited: "diffL1ManuallyEdited",
  diffL2ManuallyEdited: "diffL2ManuallyEdited",
  differenceBetweenRank1: "differenceBetweenRank1",
  differenceBetweenRank2: "differenceBetweenRank2",
  emdPaymentMode: "emdPaymentMode",
  "EMD Payment Mode": "emdPaymentMode",
  emdValidity: "emdValidity",
  evaluationTableData: "evaluationTableData",
  excludedCategory: "excludedCategory",
  "Excluded Category": "excludedCategory",
  expectedRaDate: "expectedRaDate",
  "Expected RA Date": "expectedRaDate",
  finalRemarks: "finalRemarks",
  "Final Remarks": "finalRemarks",
  locationCount: "locationCount",
  "Location Count": "locationCount",
  loiPoNoAndDate: "loiPoNoAndDate",
  "LOI / PO No & Date": "loiPoNoAndDate",
  nameOfRank1: "nameOfRank1",
  "Name of Rank 1": "nameOfRank1",
  nameOfRank2: "nameOfRank2",
  "Name of Rank 2": "nameOfRank2",
  nextAction: "nextAction",
  "Next Action": "nextAction",
  ourRank: "ourRank",
  "Our Rank": "ourRank",
  ourValue: "ourValue",
  "Our Value": "ourValue",
  parseStatus: "parseStatus",
  parseError: "parseError",
  participated: "participated",
  price: "price",
  proposedErpItemName: "proposedErpItemName",
  "Proposed ERP Item Name": "proposedErpItemName",
  proposedErpQuantity: "proposedErpQuantity",
  "Proposed ERP Quantity": "proposedErpQuantity",
  quotationNo: "quotationNo",
  "Quotation No": "quotationNo",
  rawMaterials: "rawMaterials",
  "Raw Materials": "rawMaterials",
  reason: "reason",
  reasonForNotAPM: "reasonForNotAPM",
  "Reason For Not APM": "reasonForNotAPM",
  "Reason for Not APM": "reasonForNotAPM",
  reasonfornotapm: "reasonForNotAPM",
  remarks: "remarks",
  resultAutomationStatus: "resultAutomationStatus",
  resultAutomationError: "resultAutomationError",
  reverseAuctionApplicable: "reverseAuctionApplicable",
  "Reverse Auction Applicable": "reverseAuctionApplicable",
  reverseAuctionDate: "reverseAuctionDate",
  "Reverse Auction Date": "reverseAuctionDate",
  slNo: "slNo",
  "SL No": "slNo",
  statusCategory: "statusCategory",
  "Status Category": "statusCategory",
  tenderFileUrl: "tenderFileUrl",
  "Tender File URL": "tenderFileUrl",
  tenderFor: "tenderFor",
  "Tender For": "tenderFor",
  tenderOpeningDate: "tenderOpeningDate",
  "Tender Opening Date": "tenderOpeningDate",
  tenderUpdateStatus: "tenderUpdateStatus",
  "Tender Update Status": "tenderUpdateStatus",
  valueOfRank1: "valueOfRank1",
  "Value of Rank 1": "valueOfRank1",
  valueOfRank2: "valueOfRank2",
  "Value of Rank 2": "valueOfRank2",
  website: "website",
};

const NORMALIZED_COLUMN_MAP: ColumnMap = (() => {
  const map: ColumnMap = {};
  for (const [key, value] of Object.entries(COLUMN_MAP)) {
    map[normalizeHeader(key)] = value;
  }
  return map;
})();

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[.\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function buildMergedColumnMap(
  dbMappings: { excelHeader: string; dbField: string }[],
  staticMap: ColumnMap = NORMALIZED_COLUMN_MAP,
): ColumnMap {
  const dbMap: ColumnMap = {};
  for (const m of dbMappings) {
    dbMap[normalizeHeader(m.excelHeader)] = m.dbField;
  }
  return { ...staticMap, ...dbMap };
}

export function getDisplayNameMap(
  dbMappings: { dbField: string; displayName: string | null }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of dbMappings) {
    if (m.displayName && !(m.dbField in map)) {
      map[m.dbField] = m.displayName;
    }
  }
  return map;
}

function isIgnoredHeader(header: string): boolean {
  const trimmed = header.trim();
  if (!trimmed) return true;
  if (/^__empty/i.test(trimmed)) return true;
  const normalized = normalizeHeader(trimmed);
  return !normalized;
}

export interface ParsedRow {
  knownFields: Record<string, unknown>;
  extraFields: { fieldName: string; fieldValue: string }[];
}

export function mapRowToTender(
  row: Record<string, unknown>,
  knownFieldSet: Set<string>,
  customColumnMap?: ColumnMap,
): ParsedRow {
  const columnMap = customColumnMap ?? NORMALIZED_COLUMN_MAP;
  const knownFields: Record<string, unknown> = {};
  const extraFields: { fieldName: string; fieldValue: string }[] = [];

  for (const [header, rawValue] of Object.entries(row)) {
    if (isIgnoredHeader(header)) continue;

    const normalized = normalizeHeader(header);
    const mappedField = columnMap[normalized]
      ?? (/quantity|qty/.test(normalized) && /size/.test(normalized) ? "quantity" : undefined);

    if (mappedField && knownFieldSet.has(mappedField)) {
      if (mappedField === "deadline") {
        const parsed = parseDate(rawValue);
        if (parsed) knownFields[mappedField] = parsed;
      } else if (mappedField === "app" || mappedField === "aps" || mappedField === "apm") {
        const raw = rawValue == null ? "" : String(rawValue);
        const val = raw.trim().toLowerCase();
        knownFields[mappedField] = val === "yes" ? "YES" : val === "no" ? "NO" : "NOT_DECIDED";
      } else if (mappedField === "statusCategory") {
        const raw = rawValue == null ? "" : String(rawValue);
        const val = raw.trim().toUpperCase();
        if (val === "AOC" || val === "FINANCIAL" || val === "TECHNICAL") {
          knownFields[mappedField] = val;
        }
      } else {
        const val = rawValue == null ? "" : String(rawValue).trim();
        if (val) knownFields[mappedField] = val;
      }
    } else {
      const val = rawValue == null ? "" : String(rawValue).trim();
      if (val) extraFields.push({ fieldName: header, fieldValue: val });
    }
  }

  return { knownFields, extraFields };
}

function findReferenceNoColumn(
  headers: string[],
  customColumnMap?: ColumnMap,
): string | undefined {
  for (const h of headers) {
    if (isIgnoredHeader(h)) continue;
    if (normalizeHeader(h) === "referenceno" || normalizeHeader(h) === "tenderReferenceno") return h;
  }

  const columnMap = customColumnMap ?? NORMALIZED_COLUMN_MAP;
  for (const h of headers) {
    if (isIgnoredHeader(h)) continue;
    if (/^ref(erence)?\.?\s*no(\.|mber)?$/i.test(h) || /^ref(erence)?\.?\s*no(\.|mber)?$/i.test(h.replace(/[\s_-]+/g, " "))) {
      return h;
    }
    const n = normalizeHeader(h);
    if (n.includes("ref") && n.includes("no")) return h;
    if (n === "tenderid" || n === "tid") return h;
    if (columnMap[n] === "referenceNo") return h;
  }
  return undefined;
}

export function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const rowHeaders = (rows[i] as unknown[])
      .map((h) => (h == null ? "" : String(h).trim()))
      .filter(Boolean);
    if (rowHeaders.length === 0) continue;
    if (findReferenceNoColumn(rowHeaders)) return i;
  }
  return -1;
}

export function hasReferenceNoColumn(headers: string[], customColumnMap?: ColumnMap): boolean {
  return !!findReferenceNoColumn(headers, customColumnMap);
}

const GEM_ID_PATTERN = /(GEM\/\d{4}\/[A-Z]\/\d+)/i;

export function sanitizeReferenceNo(refNo: string): string {
  const cleaned = String(refNo ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!cleaned) return cleaned;

  const gemMatch = cleaned.match(GEM_ID_PATTERN);
  return gemMatch ? gemMatch[1] : cleaned;
}

export function getReferenceNo(
  row: Record<string, unknown>,
  headers: string[],
  customColumnMap?: ColumnMap,
): string | null {
  const col = findReferenceNoColumn(headers, customColumnMap);
  if (!col) return null;
  const val = row[col];
  return val == null ? null : sanitizeReferenceNo(String(val));
}

export function isGemReference(refNo: string): boolean {
  return /gem/i.test(refNo);
}

export function filterHeaders(headers: string[]): string[] {
  return headers.filter((h) => !isIgnoredHeader(h));
}

export function findColumnByFieldName(
  headers: string[],
  fieldName: string,
  customColumnMap?: ColumnMap,
): string | undefined {
  const columnMap = customColumnMap ?? NORMALIZED_COLUMN_MAP;
  for (const h of headers) {
    if (isIgnoredHeader(h)) continue;
    const n = normalizeHeader(h);
    if (columnMap[n] === fieldName) return h;
  }
  return undefined;
}

export function getFieldValue(
  row: Record<string, unknown>,
  headers: string[],
  fieldName: string,
  customColumnMap?: ColumnMap,
): unknown {
  const col = findColumnByFieldName(headers, fieldName, customColumnMap);
  if (!col) return null;
  return row[col] ?? null;
}

export { parseDate, MERGED_FIELDS };
