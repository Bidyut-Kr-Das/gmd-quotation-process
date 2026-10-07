import "server-only";
import type { NotificationType } from "@/lib/notification-types";

export interface NotificationWebhookResult {
  success: boolean;
  error?: string;
}

export async function triggerNotificationWebhook(
  tender: Record<string, unknown>,
  notificationType: NotificationType,
): Promise<NotificationWebhookResult> {
  const url = process.env.N8N_NOTIFICATION_WEBHOOK_URL;
  if (!url) {
    console.warn(
      "[notifications] N8N_NOTIFICATION_WEBHOOK_URL not configured, skipping webhook",
    );
    return { success: false, error: "N8N_NOTIFICATION_WEBHOOK_URL not configured" };
  }

  const payload = {
    ...tender,
    notification_type: notificationType,
  };

  const referenceNo =
    (tender as { referenceNo?: string }).referenceNo ?? "unknown";

  console.log(
    `[notifications] Triggering ${notificationType} for referenceNo ${referenceNo}`,
  );

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[notifications] Webhook payload:", JSON.stringify(payload, null, 2));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[notifications] Webhook returned ${response.status}: ${text}`,
      );
      return { success: false, error: `Webhook returned ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    console.error("[notifications] Failed to send webhook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
