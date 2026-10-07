import "server-only";
import type { TenderMergedModel } from "@/generated/prisma/models/TenderMerged";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";
import type { NotificationType } from "@/lib/notification-types";
import type { NotificationMessageData } from "@/lib/notifications/messages";
import { buildNotificationMessage } from "@/lib/notifications/templates";
import { sendTextMessage } from "@/lib/integrations/evolution";

export interface NotificationMessageResult {
  success: boolean;
  error?: string;
}

function commonData(tender: TenderMergedModel) {
  return {
    referenceNo: tender.referenceNo,
    tenderBrief: tender.tenderBrief,
    organization: tender.organization,
    deadline: tender.deadline,
    location: tender.location,
    downloadLink: tender.downloadLink,
  };
}

function daysToDeadline(deadline?: Date | null): number | undefined {
  if (!deadline) return undefined;
  const diffMs = deadline.getTime() - Date.now();
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function tenderToMessageData<T extends NotificationType>(
  tender: TenderMergedModel,
  type: T,
): NotificationMessageData<T> {
  switch (type) {
    case NOTIFICATION_TYPES.DEADLINE_OVER_RESULT:
      return {
        ...commonData(tender),
        competitors: tender.competitors,
        ourRank: tender.ourRank,
        ourValue: tender.ourValue,
        nameOfRank1: tender.nameOfRank1,
        valueOfRank1: tender.valueOfRank1,
        differenceBetweenRank1: tender.differenceBetweenRank1,
      } as NotificationMessageData<T>;
    case NOTIFICATION_TYPES.DEADLINE_OVER_NOT_PARTICIPATED:
      return {
        ...commonData(tender),
        reason: tender.reason,
      } as NotificationMessageData<T>;
    case NOTIFICATION_TYPES.DEADLINE_OVER_CATALOGUE_MISSING:
      return {
        ...commonData(tender),
        daysToDeadline: daysToDeadline(tender.deadline),
      } as NotificationMessageData<T>;
    case NOTIFICATION_TYPES.DEADLINE_OVER_REASON_NOT_PROVIDED:
      return {
        ...commonData(tender),
        participated: tender.participated,
      } as NotificationMessageData<T>;
    default:
      return commonData(tender) as NotificationMessageData<T>;
  }
}

export async function sendNotificationMessage(
  tender: TenderMergedModel,
  type: NotificationType,
  recipient: string | undefined,
): Promise<NotificationMessageResult> {
  if (!recipient) {
    console.warn(
      `[notifications] Recipient number not configured for ${type}, skipping send`,
    );
    return { success: false, error: "Recipient number not configured" };
  }

  const data = tenderToMessageData(tender, type);
  const text = buildNotificationMessage(type, data);
  const result = await sendTextMessage(recipient, text);

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}
