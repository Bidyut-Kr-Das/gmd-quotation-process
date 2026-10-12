/**
 * Docket email send via n8n.
 *
 * The app does not send mail itself — it POSTs a multipart/form-data payload to
 * an n8n Webhook node which relays it through a Gmail (OAuth) node. The Offer
 * PDF travels as the binary field `attachment`; the rest of the fields are plain
 * form values (surfaced in n8n as `$json`).
 *
 * Configure `N8N_DOCKET_WEBHOOK_URL` (server-only). See
 * `documentation/n8n/send-docket-email.workflow.json` for the matching workflow.
 */

export interface DocketEmailPayload {
  /** Primary recipient — Enquiry.senderEmail. */
  to: string;
  /** Comma-separated recipients — Enquiry.emailAddress. */
  cc: string;
  subject: string;
  html: string;
  docketNumber: string;
  fileName: string;
  pdfBuffer: Buffer;
}

export interface DocketEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Address always copied on every docket email, regardless of docket Cc. */
export const DOCKET_EMAIL_ALWAYS_CC = "puja.agarwal@laserpowerinfra.com";

export async function sendDocketEmailViaN8n(
  payload: DocketEmailPayload,
): Promise<DocketEmailResult> {
  const webhookUrl = process.env.N8N_DOCKET_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[n8n-email] N8N_DOCKET_WEBHOOK_URL not set, skipping send");
    return { success: false, error: "Email webhook is not configured (N8N_DOCKET_WEBHOOK_URL)." };
  }

  try {
    const form = new FormData();
    form.append("to", payload.to);
    form.append("cc", payload.cc ?? "");
    form.append("subject", payload.subject);
    form.append("html", payload.html);
    form.append("docketNumber", payload.docketNumber);
    form.append("fileName", payload.fileName);
    form.append(
      "attachment",
      new Blob([new Uint8Array(payload.pdfBuffer)], { type: "application/pdf" }),
      payload.fileName,
    );

    const response = await fetch(webhookUrl, { method: "POST", body: form });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      console.warn("[n8n-email] send failed", {
        docketNumber: payload.docketNumber,
        status: response.status,
        body: text,
      });
      return { success: false, error: `n8n responded ${response.status}` };
    }

    let messageId: string | undefined;
    try {
      messageId = JSON.parse(text)?.messageId;
    } catch {
      // n8n may respond with an empty/plain body; that is still a success.
    }

    console.log("[n8n-email] sent", { docketNumber: payload.docketNumber, status: response.status });
    return { success: true, messageId };
  } catch (error) {
    console.error("[n8n-email] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reach the email webhook.",
    };
  }
}
