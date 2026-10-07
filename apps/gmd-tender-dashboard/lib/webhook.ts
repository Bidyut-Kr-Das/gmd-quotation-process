const N8N_WEBHOOK_URL_PROD = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_URL_TEST = process.env.N8N_WEBHOOK_URL_TEST;

interface WebhookPayload {
  tenderReferenceNumber: string;
  tenderId: string;
  itemScope: string;
  tenderAuthority: string;
  submissionDate: string;
  assignedTo: { name: string; email: string } | null;
  source: string;
  portalLink: string;
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${day}-${month}-${year} ${displayHours}:${minutes} ${ampm}`;
}

interface TenderWebhookData {
  referenceNo: string;
  itemCategory: string | null;
  organization: string | null;
  deadline: Date | null;
  tenderFileUrl: string | null;
}

export async function sendTenderWebhook(
  tender: TenderWebhookData,
  type: "Gem" | "Non-Gem",
  associations: { association: { name: string; email: string } }[],
) {
  const url =
    process.env.ENVIRONMENT === "PROD"
      ? N8N_WEBHOOK_URL_PROD
      : N8N_WEBHOOK_URL_TEST;
  if (!url) {
    console.warn(
      `[webhook] N8N webhook URL not configured (ENVIRONMENT=${process.env.ENVIRONMENT})`,
    );
    return;
  }

  const payload: WebhookPayload = {
    tenderReferenceNumber: tender.referenceNo,
    tenderId: tender.referenceNo,
    itemScope: tender.itemCategory || "",
    tenderAuthority: tender.organization || "",
    submissionDate: tender.deadline ? formatDate(tender.deadline) : "",
    assignedTo:
      associations.length > 0
        ? {
            name: associations[0].association.name,
            email: associations[0].association.email,
          }
        : null,
    source: type === "Gem" ? "GEM" : "Non-GEM",
    portalLink: tender.tenderFileUrl || "",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(
        `Webhook returned ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    return await response.json() as { success: boolean; message: string } | null;
  } catch (error) {
    console.error("Failed to send webhook:", error);
    return null;
  }
}
