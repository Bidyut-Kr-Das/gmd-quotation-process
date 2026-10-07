export const REASON_FOR_NOT_APM_OPTIONS = [
  "Not Enlisted",
  "BIS Issue",
  "Special Certification Required",
  "Poor Payment Terms",
  "Quantity Restrain",
] as const;

export type ReasonForNotAPMOption = (typeof REASON_FOR_NOT_APM_OPTIONS)[number];
