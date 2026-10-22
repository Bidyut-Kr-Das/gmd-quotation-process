export const TENDER_REASON_OPTIONS = [
  "the contract has been awarded to us",
  "the contract has been awarded to another bidder",
  "we are not the L1 bidder",
  "our bid has been disqualified or declared unsuccessful",
] as const;

export type TenderReasonOption = (typeof TENDER_REASON_OPTIONS)[number];
