export interface VaAlertPayload {
  docketNumber: string;
  itemName: string;
  itemNameMerge: string | null;
  itemType: string | null;
  size: string | null;
  vaPercent: number;
  maxVaPercent: number;
}

export async function sendVaAlert(payload: VaAlertPayload): Promise<{ success: boolean }> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[n8n] N8N_WEBHOOK_URL not set, skipping alert");
    return { success: false };
  }

  if (!payload.docketNumber || !payload.itemName || payload.vaPercent == null || payload.maxVaPercent == null) {
    console.warn("[n8n] Invalid payload — missing required fields", payload);
    return { success: false };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log("[n8n] VA alert sent successfully", { docketNumber: payload.docketNumber, status: response.status });
      return { success: true };
    }

    const body = await response.text().catch(() => "");
    console.warn("[n8n] VA alert failed", { status: response.status, body });
    return { success: false };
  } catch (error) {
    console.error("[n8n] VA alert error", error);
    return { success: false };
  }
}
