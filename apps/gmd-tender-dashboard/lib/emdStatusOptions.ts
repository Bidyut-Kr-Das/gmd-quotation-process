export const EMD_STATUS_OPTIONS = ["RUNNING", "EXPIRED", "CLOSED", "OTHER"] as const;
export type EmdStatusOption = (typeof EMD_STATUS_OPTIONS)[number];
