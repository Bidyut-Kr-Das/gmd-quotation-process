export enum ManagementDecision {
  GO = "Go",
  NO_GO = "No Go",
  PENDING = "Pending",
  DEFERRED = "Deferred"
}

export enum CurrentStatus {
  SUBMITTED = "Submitted",
  WON = "Won",
  LOST = "Lost",
  UNDER_EVALUATION = "Under Evaluation",
  RA_PENDING = "RA Pending",
  IN_PREPARATION = "In Preparation",
  CANCELLED = "Cancelled"
}

export enum StatusCategory {
  AOC = "AOC",
  FINANCIAL = "FINANCIAL",
  TECHNICAL = "TECHNICAL",
}

export enum EMDExchangeMode {
  BG = "BG",
  NEFT = "NEFT",
  EXEMPTED = "Exempted",
  NOT_APPLICABLE = "Not Applicable"
}

export interface EpcTenderRecord {
  id?: string;
  slNo: number;
  docketNo: string;
  tenderFor: string;
  tenderNoNitNo: string;
  nameOfWorkDescription?: string;
  totalQuantityMeter?: number | null;
  nameOfTheClient: string;
  lastDateOfSubmission: Date | null;
  tenderOpeningDate: Date | null;
  costOfTenderFeeRs: number | null;
  emdAmountRs: number | null;
  estimatedCostRs: number | null;
  bidValidityDays: number | null;
  contractPeriodDays: number | null;
  managementDecision: ManagementDecision;
  catalogueDone?: "YES" | "NO" | "NOT_DECIDED" | null;
  participated: boolean | null;
  tenderPrepareBy: string;
  currentStatus: string;
  tenderSubmittedDate: Date | null;
  reverseAuctionApplicable: boolean | null;
  reverseAuctionDate: Date | null;
  reverseAuctionStartDate: Date | null;
  reverseAuctionEndDate: Date | null;
  expectedRaDate?: string | null;
  emdPaymentMode: EMDExchangeMode | null;
  bgNoUtrNo: string | null;
  emdValidity: Date | null;
  loiPoNoAndDate: string | null;
  remarks: string | null;
  bidValidityExpired: boolean | null;
  diffPercentFromL1: number | null;
  diffPercentFromL2: number | null;
  reason: string | null;
  finalRemarks: string | null;
  attachmentUrl?: string | null;
  tenderFiles?: string;
  priceBasis?: string | null;
  applicableIndex?: string | null;
  tenderType?: string | null;
  tenderBrief?: string | null;
  aluminiumPrice?: number | null;
  aluminiumAlloyPrice?: number | null;
  copperTapePrice?: number | null;
  extrudedSemiconductivePrice?: number | null;
  htXlpePrice?: number | null;
  pvcTypeSt2Price?: number | null;
  galvanisedSteelFlatStripPrice?: number | null;
  fillerPrice?: number | null;
  proposedErpItemName?: string;
  proposedErpQuantity?: string;
  typetest?: string | null;
  rawMaterials?: string;
  statusCategory?: StatusCategory;
  itemCategory?: string | null;
  itemSchedules?: string[];
  costingDetails?: string;
  competitors?: string | null;
  fileCount?: number;
  hasBoqChart?: boolean;
  boqFileId?: string;
  bgStatus?: string | null;
  beneficiaryBankDetails?: string | null;
  issuingBank?: string | null;
  price?: string | null;
  tenderUpdateStatus?: TenderUpdateStatus;
  nextAction?: NextAction | null;
  quotationNo?: string | null;
  contractNo?: string | null;
  cva?: string | null;
  officeName?: string;
  consigneesReportingOfficer?: string;
  miiPurchasePreference?: string | null;
  website?: string | null;
  raQualificationRule?: string | null;
  startupExemption?: string | null;
  minimumAverageAnnualTurnover?: string | null;
  yearsOfPastExperience?: string | null;
  ePbgDurationMonths?: string | null;
  // verbatim tender_merged fields — each separate column per requirement
  documentFees?: string | null;
  contractPeriod?: string | null;
  bidOfferValidity?: string | null;
  location?: string | null;
  documentRequiredFromSeller?: string | null;
  pastPerformance?: string | null;
  typeOfBid?: string | null;
  technicalClarificationTimeAllowed?: string | null;
  mediationClause?: string | null;
  arbitrationClause?: string | null;
  oemAverageTurnover?: string | null;
  ePbgPercentage?: string | null;
  msmeExemption?: string | null;
  msePurchasePreference?: string | null;
  emd?: string | null;
  bgDate?: string | null;
  bgExpiryDate?: string | null;
  claimDate?: string | null;
  reportings?: string;
  ourRank?: string | null;
  ourValue?: string | null;
  nameOfRank1?: string | null;
  valueOfRank1?: string | null;
  differenceBetweenRank1?: string | null;
  nameOfRank2?: string | null;
  valueOfRank2?: string | null;
  differenceBetweenRank2?: string | null;
  publishedDate?: Date | null;
  assignedDate?: Date | null;
  assignedTo?: string;
}

export enum TenderUpdateStatus {
  OPEN = "OPEN",
  CLOSED = "CLOSED"
}

export const CURRENT_STATUS_OPTIONS = [
  "AWARDED",
  "FINANCIAL EVALUATION",
  "TENDER CANCELLED",
  "TECHNICAL BID OPENED",
  "NOT EVALUATED",
  "DISQUALIFIED",
] as const;

export enum NextAction {
  UPDATE_FROM_AB_LETTER = "UPDATE_FROM_AB_LETTER",
  BG_REFUND_LETTER_TO_BE_SENT = "BG_REFUND_LETTER_TO_BE_SENT",
  FOLLOW_UP_FOR_FINANCIAL_STATUS = "FOLLOW_UP_FOR_FINANCIAL_STATUS",
  REVERSE_AUCTION_PENDING = "REVERSE_AUCTION_PENDING",
  COUNTER_OFFER_YES = "COUNTER_OFFER_YES",
  COUNTER_OFFER_NO = "COUNTER_OFFER_NO",
  BID_VALIDITY_NOT_ACCEPTED = "BID_VALIDITY_NOT_ACCEPTED"
}
