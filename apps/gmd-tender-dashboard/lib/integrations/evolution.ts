import "server-only";

export interface EvolutionMessageResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_API_BASE_URL ?? "http://evolution-api:8080";
const EVOLUTION_INSTANCE =
  process.env.EVOLUTION_API_INSTANCE ?? "Bidyut Kr. Das";

export async function sendTextMessage(
  number: string,
  text: string,
  options?: { instance?: string },
): Promise<EvolutionMessageResult> {
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!apikey) {
    console.warn("[evolution] EVOLUTION_API_KEY not configured, skipping send");
    return { success: false, error: "EVOLUTION_API_KEY not configured" };
  }

  const instance = encodeURIComponent(options?.instance ?? EVOLUTION_INSTANCE);
  const url = `${EVOLUTION_BASE_URL}/message/sendText/${instance}`;

  console.log(`[evolution] Sending text message to ${number}`);

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[evolution] Payload:", JSON.stringify({ number, text }, null, 2));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey,
      },
      body: JSON.stringify({ number, text }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error(`[evolution] sendText returned ${response.status}:`, data);
      return {
        success: false,
        error: `sendText returned ${response.status}`,
        data,
      };
    }

    return { success: true, data };
  } catch (error) {
    console.error("[evolution] sendText failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
