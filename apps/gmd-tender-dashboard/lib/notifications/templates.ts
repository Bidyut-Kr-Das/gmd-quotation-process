import "server-only";
import Handlebars from "handlebars";
import { format } from "date-fns";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";
import type { NotificationType } from "@/lib/notification-types";
import type { NotificationMessageData } from "@/lib/notifications/messages";

Handlebars.registerHelper(
  "formatDate",
  (value: Date | string | null | undefined) => {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "dd MMM yyyy");
  },
);

export const NOTIFICATION_TEMPLATES: Record<NotificationType, string> = {
  [NOTIFICATION_TYPES.DEADLINE_OVER_RESULT]:
    "Result Declared\n\n" +
    "Tender No: {{referenceNo}}\n" +
    "Tender: {{tenderBrief}}\n" +
    "Organization: {{organization}}\n" +
    "Deadline: {{formatDate deadline}}\n\n" +
    "Rank: {{ourRank}}\n" +
    "Our Value: {{ourValue}}\n" +
    "Competitors: {{competitors}}",

  [NOTIFICATION_TYPES.DEADLINE_OVER_NOT_PARTICIPATED]:
    "Deadline Over - Not Participated\n\n" +
    "Tender No: {{referenceNo}}\n" +
    "Tender: {{tenderBrief}}\n" +
    "Organization: {{organization}}\n" +
    "Deadline: {{formatDate deadline}}\n\n" +
    "Reason: {{reason}}",

  [NOTIFICATION_TYPES.DEADLINE_OVER_CATALOGUE_MISSING]:
    "Catalogue Missing\n\n" +
    "Tender No: {{referenceNo}}\n" +
    "Tender: {{tenderBrief}}\n" +
    "Organization: {{organization}}\n" +
    "Deadline: {{formatDate deadline}}" +
    "{{#if daysToDeadline}} (in {{daysToDeadline}} days){{/if}}\n\n" +
    "Please complete the catalogue before the deadline.",

  [NOTIFICATION_TYPES.DEADLINE_OVER_REASON_NOT_PROVIDED]:
    "Deadline Over - Reason Required\n\n" +
    "Tender No: {{referenceNo}}\n" +
    "Tender: {{tenderBrief}}\n" +
    "Organization: {{organization}}\n" +
    "Deadline: {{formatDate deadline}}\n\n" +
    "Please provide the reason for not participating.",
};

export function buildNotificationMessage<T extends NotificationType>(
  type: T,
  data: NotificationMessageData<T>,
): string {
  const source = NOTIFICATION_TEMPLATES[type];
  const template = Handlebars.compile<NotificationMessageData<T>>(source, {
    noEscape: true,
  });
  return template(data);
}
