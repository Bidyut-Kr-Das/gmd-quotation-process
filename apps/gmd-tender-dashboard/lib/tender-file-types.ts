export const TENDER_FILE_TYPES = {
  TENDER_DOCUMENT: "tenderDocument",
  COSTING_ATTACHMENT: "costingAttachment",
  NETWORK_FILES: "networkFiles",
  BOQ_COMPARATIVE_CHART: "boqComparativeChart",
  CATALOGUE_DOCUMENT: "catalogueDocument",
  RA_COSTING_SHEET: "raCostingSheet",
} as const;

export type TenderFileType =
  (typeof TENDER_FILE_TYPES)[keyof typeof TENDER_FILE_TYPES];
