export type FieldType = "date" | "int" | "float" | "boolean" | "string";

export interface FieldDefinition {
  name: string;
  type: FieldType;
}

export interface SheetRecord {
  slNo: number;
  docketNo: string;
  tenderFor: string;
  typeOfTender: string;
  tenderNoNitNo: string;
  nameOfWorkDescription?: string | null;
  totalQuantityMeter?: number | null;
  nameOfTheClient: string;
  lastDateOfSubmission: Date | string | null;
  tenderOpeningDate: Date | string | null;
  costOfTenderFeeRs: number | null;
  emdAmountRs: number | null;
  estimatedCostRs: number | null;
  bidValidityDays: number | null;
  contractPeriodDays: number | null;
  managementDecision: string;
  participated: boolean | null;
  tenderPrepareBy: string;
  currentStatus: string;
  tenderSubmittedDate: Date | string | null;
  reverseAuctionApplicable: boolean | null;
  reverseAuctionDate: Date | string | null;
  emdPaymentMode: string | null;
  bgNoUtrNo: string | null;
  emdValidity: Date | string | null;
  loiPoNoAndDate: string | null;
  remarks: string | null;
  bidValidityExpired: boolean;
  diffPercentFromL1: number | null;
  diffPercentFromL2: number | null;
  reason: string | null;
  finalRemarks: string | null;
  attachmentUrl: string | null;
  [key: string]: unknown;
}

export interface UpsertResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface DatabaseTenderData {
  slNo: number;
  docketNo: string;
  tenderFor: string;
  typeOfTender: string;
  tenderNoNitNo: string;
  nameOfWorkDescription: string | null;
  totalQuantityMeter: number | null;
  nameOfTheClient: string;
  lastDateOfSubmission: Date | null;
  tenderOpeningDate: Date | null;
  costOfTenderFeeRs: number | null;
  emdAmountRs: number | null;
  estimatedCostRs: number | null;
  bidValidityDays: number | null;
  contractPeriodDays: number | null;
  managementDecision: string;
  participated: boolean;
  tenderPrepareBy: string;
  currentStatus: string;
  tenderSubmittedDate: Date | null;
  reverseAuctionApplicable: boolean | null;
  reverseAuctionDate: Date | null;
  emdPaymentMode: string | null;
  bgNoUtrNo: string | null;
  emdValidity: Date | null;
  loiPoNoAndDate: string | null;
  remarks: string | null;
  bidValidityExpired: boolean;
  diffPercentFromL1: number | null;
  diffPercentFromL2: number | null;
  reason: string | null;
  finalRemarks: string | null;
  attachmentUrl: string | null;
  tenderUpdateStatus?: string;
  nextAction?: string | null;
  diffL1ManuallyEdited?: boolean;
  diffL2ManuallyEdited?: boolean;
}
