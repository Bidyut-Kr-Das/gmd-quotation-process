export const NOTIFICATION_TYPES = {
  DEADLINE_OVER_RESULT: "deadline_over_result_notification",
  DEADLINE_OVER_NOT_PARTICIPATED: "deadline_over_not_participated_notification",
  DEADLINE_OVER_CATALOGUE_MISSING: "deadline_over_catalogue_missing_notification",
  DEADLINE_OVER_REASON_NOT_PROVIDED: "deadline_over_reason_not_provided_notification",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_DEADLINE_START = new Date("2026-07-20T00:00:00.000Z");
