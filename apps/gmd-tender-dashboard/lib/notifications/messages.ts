import { NOTIFICATION_TYPES } from "@/lib/notification-types";
import type { NotificationType } from "@/lib/notification-types";

interface CommonTenderMessageData {
  referenceNo: string;
  tenderBrief?: string | null;
  organization?: string | null;
  deadline?: Date | string | null;
  location?: string | null;
  downloadLink?: string | null;
}

export interface DeadlineOverResultMessageData extends CommonTenderMessageData {
  competitors?: string | null;
  ourRank?: string | null;
  ourValue?: string | null;
  nameOfRank1?: string | null;
  valueOfRank1?: string | null;
  differenceBetweenRank1?: string | null;
}

export interface DeadlineOverNotParticipatedMessageData
  extends CommonTenderMessageData {
  reason?: string | null;
}

export interface DeadlineOverCatalogueMissingMessageData
  extends CommonTenderMessageData {
  daysToDeadline?: number | null;
}

export interface DeadlineOverReasonNotProvidedMessageData
  extends CommonTenderMessageData {
  participated?: boolean | null;
}

export interface NotificationMessageMap {
  [NOTIFICATION_TYPES.DEADLINE_OVER_RESULT]: DeadlineOverResultMessageData;
  [NOTIFICATION_TYPES.DEADLINE_OVER_NOT_PARTICIPATED]: DeadlineOverNotParticipatedMessageData;
  [NOTIFICATION_TYPES.DEADLINE_OVER_CATALOGUE_MISSING]: DeadlineOverCatalogueMissingMessageData;
  [NOTIFICATION_TYPES.DEADLINE_OVER_REASON_NOT_PROVIDED]: DeadlineOverReasonNotProvidedMessageData;
}

export type NotificationMessageData<T extends NotificationType> =
  NotificationMessageMap[T];
