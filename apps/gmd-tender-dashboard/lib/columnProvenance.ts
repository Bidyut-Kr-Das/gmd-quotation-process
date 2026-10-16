// Mapping of TenderTable columns to participation dashboards
// Direct accessor equality, except two aliases: tenderNoNitNo <-> referenceNo, lastDateOfSubmission <-> deadline

const FULL_COLUMNS: string[] = [
  "docketNo",
  "tenderType",
  "tenderNoNitNo",
  "lastDateOfSubmission",
  "publishedDate",
  "assignedDate",
  "nameOfTheClient",
  "tenderBrief",
  "itemSchedules",
  "proposedErpItemName",
  "proposedErpQuantity",
  "typeTests",
  "typetest",
  "attachmentUrl",
  "files",
  "boqChart",
  "price",
  "applicableIndex",
  "rawMaterials",
  "emdPaymentMode",
  "emd",
  "bgDate",
  "bgExpiryDate",
  "claimDate",
  "bgNoUtrNo",
  "bgStatus",
  "beneficiaryBankDetails",
  "issuingBank",
  "currentStatus",
  "statusCategory",
  "reason",
  "remarks",
  "reverseAuctionApplicable",
  "reverseAuctionStartDate",
  "reverseAuctionEndDate",
  "expectedRaDate",
  "loiPoNoAndDate",
  "quotationNo",
  "contractNo",
  "competitors",
  "ourRank",
  "ourValue",
  "nameOfRank1",
  "valueOfRank1",
  "differenceBetweenRank1",
  "nameOfRank2",
  "valueOfRank2",
  "differenceBetweenRank2",
  "tenderUpdateStatus",
  "nextAction",
  "cva",
  "managementDecision",
  "catalogueDone",
  "tenderPrepareBy",
  "participated",
  "merged_office_consignees",
  "miiPurchasePreference",
  "tenderDocument",
  "reportings",
  "website",
  "raQualificationRule",
  "startupExemption",
  "minimumAverageAnnualTurnover",
  "yearsOfPastExperience",
  "ePbgDurationMonths",
  "documentFees",
  "contractPeriod",
  "bidOfferValidity",
  "bidValidityExpired",
  "location",
  "documentRequiredFromSeller",
  "pastPerformance",
  "typeOfBid",
  "technicalClarificationTimeAllowed",
  "mediationClause",
  "arbitrationClause",
  "oemAverageTurnover",
  "ePbgPercentage",
  "msmeExemption",
  "msePurchasePreference",
];

const postParticipationAccessors = new Set<string>([
  "bgNoUtrNo", "remarks", "loiPoNoAndDate",
  "competitors",
  "nextAction",
  "quotationNo", "currentStatus",
  "ourRank", "ourValue",
  "nameOfRank1", "valueOfRank1",
  "nameOfRank2", "valueOfRank2",
  "issuingBank", "expectedRaDate",
]);

const postParticipationExcludeAccessors = new Set<string>([
  "merged_office_consignees", "miiPurchasePreference", "tenderDocument",
  "reportings", "website", "raQualificationRule", "startupExemption",
  "minimumAverageAnnualTurnover", "yearsOfPastExperience", "ePbgDurationMonths",
  "beneficiaryBankDetails",
  // new verbatim columns — PRE only per requirement (keep all prior unchanged)
  "documentFees",
  "contractPeriod",
  "bidOfferValidity",
  "bidValidityExpired",
  "location",
  "documentRequiredFromSeller",
  "pastPerformance",
  "typeOfBid",
  "technicalClarificationTimeAllowed",
  "mediationClause",
  "arbitrationClause",
  "oemAverageTurnover",
  "ePbgPercentage",
  "msmeExemption",
  "msePurchasePreference",
]);

const postParticipationHiddenAccessors = new Set<string>([
  "publishedDate",
  "assignedDate",
  "claimDate",
  "statusCategory",
  "reason",
  "loiPoNoAndDate",
  "managementDecision",
  "catalogueDone",
  "participated",
]);

function buildPreSet(): Set<string> {
  const s = new Set<string>();
  for (const c of FULL_COLUMNS) {
    if (postParticipationAccessors.has(c)) continue;
    // PRE has showTypeTestColumn=true, so keep typeTests
    s.add(c);
  }
  return s;
}

function buildPostSet(): Set<string> {
  const s = new Set<string>();
  for (const c of FULL_COLUMNS) {
    if (postParticipationExcludeAccessors.has(c)) continue;
    if (postParticipationHiddenAccessors.has(c)) continue;
    // POST has showTypeTestColumn=false, so hide typeTests/typetest
    if (c === "typeTests" || c === "typetest") continue;
    s.add(c);
  }
  return s;
}

function buildNotSet(): Set<string> {
  const s = new Set<string>();
  for (const c of FULL_COLUMNS) {
    if (postParticipationExcludeAccessors.has(c)) continue;
    // hidden but reason exception
    if (postParticipationHiddenAccessors.has(c) && c !== "reason") continue;
    if (c === "typeTests" || c === "typetest") continue;
    s.add(c);
  }
  return s;
}

const PRE_SET = buildPreSet();
const POST_SET = buildPostSet();
const NOT_SET = buildNotSet();

// Only two aliases as per spec: tender/nit no <-> referenceNo, last date <-> deadline
const ALIAS_TO_TENDERS: Record<string, string> = {
  tenderNoNitNo: "referenceNo",
  lastDateOfSubmission: "deadline",
};
const TENDERS_TO_CANONICAL: Record<string, string> = {
  referenceNo: "tenderNoNitNo",
  deadline: "lastDateOfSubmission",
};

export type ProvenanceBadge = "PRE" | "POST" | "NOT_PARTICIPATED";

export function getProvenance(tendersAccessor: string): ProvenanceBadge[] {
  const canonical = TENDERS_TO_CANONICAL[tendersAccessor] ?? tendersAccessor;
  const badges: ProvenanceBadge[] = [];
  if (PRE_SET.has(canonical)) badges.push("PRE");
  if (POST_SET.has(canonical)) badges.push("POST");
  if (NOT_SET.has(canonical)) badges.push("NOT_PARTICIPATED");
  return badges;
}

export function getProvenanceForFields(fields: string[]): ProvenanceBadge[] {
  const union = new Set<ProvenanceBadge>();
  for (const f of fields) {
    for (const b of getProvenance(f)) union.add(b);
  }
  // If fields contain aliases already, also handle tenders alias direction
  // Also support fields that are tenders aliases directly
  for (const f of fields) {
    const canonical = TENDERS_TO_CANONICAL[f] ?? f;
    for (const b of getProvenance(canonical)) union.add(b);
  }
  const order: ProvenanceBadge[] = ["PRE", "POST", "NOT_PARTICIPATED"];
  return order.filter((b) => union.has(b));
}

export function getTendersAliasForCanonical(canonical: string): string | undefined {
  return ALIAS_TO_TENDERS[canonical];
}
