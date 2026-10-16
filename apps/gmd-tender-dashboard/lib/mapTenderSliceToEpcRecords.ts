import { TenderData } from "@/lib/slices/tendersSlice";
import { EpcTenderRecord, ManagementDecision, NextAction, StatusCategory, EMDExchangeMode, TenderUpdateStatus } from "@/types/tender";

function parseFloatOrNull(val: string | undefined | null): number | null {
  if (val == null || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseIntOrNull(val: string | undefined | null): number | null {
  if (val == null || val === "") return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function resolveAssociationNames(
  assignedTo: string | undefined,
  namesById: Map<number, string>,
): string {
  if (!assignedTo) return "";
  const ids = assignedTo.split(",").filter(Boolean);
  const names = ids
    .map((id) => namesById.get(parseInt(id, 10)))
    .filter(Boolean);
  return names.join(", ");
}

function parseItemSchedules(val: string | undefined): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) {
      return parsed
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {}
  return val
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mapTenderSliceToEpcRecords(tenderData: TenderData | null): EpcTenderRecord[] {
  if (!tenderData) return [];
  // One Map instead of a linear `associations.find` per assigned id per row.
  const associationNamesById = new Map(
    tenderData.associations.map((a) => [a.id, a.name] as const),
  );
  return tenderData.rows.map((row, index) => ({
    id: row.id,
    slNo: index + 1,
    docketNo: row.docketNo || "",
    tenderFor: "",
    tenderNoNitNo: row.referenceNo || "",
    nameOfWorkDescription: row.tenderBrief || "",
    totalQuantityMeter: parseFloatOrNull(row.totalQuantity ?? row.quantity),
    nameOfTheClient: row.organization || "",
    lastDateOfSubmission: row.deadline ? new Date(row.deadline) : null,
    tenderOpeningDate: row.bidOpeningDateTime ? new Date(row.bidOpeningDateTime) : null,
    costOfTenderFeeRs: parseFloatOrNull(row.documentFees),
    emdAmountRs: parseFloatOrNull(row.emd),
    estimatedCostRs: parseFloatOrNull(row.value ?? row.estimatedBidValue),
    bidValidityDays: parseIntOrNull(row.bidOfferValidity),
    contractPeriodDays: parseIntOrNull(row.contractPeriod),
    managementDecision: (row.apm || "Pending") as ManagementDecision,
    catalogueDone: (row.catalogueDone as "YES" | "NO" | "NOT_DECIDED") || null,
    participated: row.participated === "true" ? true : row.participated === "false" ? false : null,
    tenderPrepareBy: resolveAssociationNames(row.assignedTo, associationNamesById),
    currentStatus: row.currentStatus || "",
    tenderSubmittedDate: row.scrapedDate ? new Date(row.scrapedDate) : null,
    reverseAuctionApplicable: row.raQualificationRule
      ? true
      : row.reverseAuctionApplicable === "true"
        ? true
        : row.reverseAuctionApplicable === "false"
          ? false
          : null,
    reverseAuctionDate: row.reverseAuctionDate
      ? new Date(row.reverseAuctionDate)
      : null,
    reverseAuctionStartDate: row.reverseAuctionStartDate
      ? new Date(row.reverseAuctionStartDate)
      : null,
    reverseAuctionEndDate: row.reverseAuctionEndDate
      ? new Date(row.reverseAuctionEndDate)
      : null,
    expectedRaDate: row.expectedRaDate || null,
    emdPaymentMode: (row.emdPaymentMode as EMDExchangeMode) || null,
    bgNoUtrNo: row.bgNoUtrNo || null,
    emdValidity: null,
    loiPoNoAndDate: row.loiPoNoAndDate || null,
    remarks: row.remarks || null,
    bidValidityExpired: row.bidValidityExpired === "true" ? true : row.bidValidityExpired === "false" ? false : row.bidValidityExpired === "1" ? true : row.bidValidityExpired === "0" ? false : null,
    diffPercentFromL1: parseFloatOrNull(row.diffPercentFromL1),
    diffPercentFromL2: parseFloatOrNull(row.diffPercentFromL2),
    reason: row.reason || null,
    finalRemarks: null,
    attachmentUrl: null,
    tenderFiles: row.tenderFiles || "",
    priceBasis: row.priceBasis || null,
    price: row.price || null,
    applicableIndex: row.applicableIndex || null,
    tenderType: row.tenderType || null,
    tenderBrief: row.tenderBrief || null,
    aluminiumPrice: parseFloatOrNull(row.aluminiumPrice),
    aluminiumAlloyPrice: parseFloatOrNull(row.aluminiumAlloyPrice),
    copperTapePrice: parseFloatOrNull(row.copperTapePrice),
    extrudedSemiconductivePrice: null,
    htXlpePrice: null,
    pvcTypeSt2Price: null,
    galvanisedSteelFlatStripPrice: null,
    fillerPrice: null,
    proposedErpItemName: row.proposedErpItemName || undefined,
    proposedErpQuantity: row.proposedErpQuantity || undefined,
    typetest: row.typetest || null,
    rawMaterials: row.rawMaterials || undefined,
    statusCategory: row.statusCategory as StatusCategory | undefined,
    itemCategory: row.itemCategory || null,
    itemSchedules: parseItemSchedules(row.itemSchedules),
    costingDetails: (row as any).costingDetails || undefined,
    competitors: row.competitors || null,
    fileCount: undefined,
    hasBoqChart: undefined,
    boqFileId: undefined,
    bgStatus: row.bgStatus || null,
    beneficiaryBankDetails: row.beneficiaryBankDetails || null,
    issuingBank: row.issuingBank || null,
    emd: row.emd || null,
    bgDate: row.bgDate || null,
    bgExpiryDate: row.bgExpiryDate || null,
    claimDate: row.claimDate || null,
    tenderUpdateStatus: (row.tenderUpdateStatus || "OPEN") as TenderUpdateStatus,
    nextAction: (row.nextAction || null) as NextAction | null,
    quotationNo: row.quotationNo || null,
    contractNo: row.contractNo || null,
    cva: row.cva || undefined,
    officeName: row.officeName || "",
    consigneesReportingOfficer: row.consigneesReportingOfficer || "",
    miiPurchasePreference: row.miiPurchasePreference || null,
    website: row.website || null,
    raQualificationRule: row.raQualificationRule || null,
    startupExemption: row.startupExemption || null,
    minimumAverageAnnualTurnover: row.minimumAverageAnnualTurnover || null,
    yearsOfPastExperience: row.yearsOfPastExperience || null,
    ePbgDurationMonths: row.ePbgDurationMonths || null,
    documentFees: row.documentFees || null,
    contractPeriod: row.contractPeriod || null,
    bidOfferValidity: row.bidOfferValidity || null,
    location: row.location || null,
    documentRequiredFromSeller: row.documentRequiredFromSeller || null,
    pastPerformance: row.pastPerformance || null,
    typeOfBid: row.typeOfBid || null,
    technicalClarificationTimeAllowed: row.technicalClarificationTimeAllowed || null,
    mediationClause: row.mediationClause || null,
    arbitrationClause: row.arbitrationClause || null,
    oemAverageTurnover: row.oemAverageTurnover || null,
    ePbgPercentage: row.ePbgPercentage || null,
    msmeExemption: row.msmeExemption || null,
    msePurchasePreference: row.msePurchasePreference || null,
    reportings: row.reportings || "",
    ourRank: row.ourRank || null,
    ourValue: row.ourValue || null,
    nameOfRank1: row.nameOfRank1 || null,
    valueOfRank1: row.valueOfRank1 || null,
    differenceBetweenRank1: row.differenceBetweenRank1 || null,
    nameOfRank2: row.nameOfRank2 || null,
    valueOfRank2: row.valueOfRank2 || null,
    differenceBetweenRank2: row.differenceBetweenRank2 || null,
    publishedDate: row.publishedDate ? new Date(row.publishedDate) : null,
    assignedDate: row.assignedDate ? new Date(row.assignedDate) : null,
    assignedTo: (row.assignedTo as string) || "",
  }));
}
