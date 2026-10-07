import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== "false";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

/**
 * Canonical Indian States + UTs (36) – UPPER, matches expanded LookupOption set.
 * Existing DB may only have 29; new derived values will use this full list.
 */
export const INDIAN_STATES = [
  "ANDHRA PRADESH",
  "ARUNACHAL PRADESH",
  "ASSAM",
  "BIHAR",
  "CHHATTISGARH",
  "GOA",
  "GUJARAT",
  "HARYANA",
  "HIMACHAL PRADESH",
  "JHARKHAND",
  "KARNATAKA",
  "KERALA",
  "MADHYA PRADESH",
  "MAHARASHTRA",
  "MANIPUR",
  "MEGHALAYA",
  "MIZORAM",
  "NAGALAND",
  "ODISHA",
  "PUNJAB",
  "RAJASTHAN",
  "SIKKIM",
  "TAMIL NADU",
  "TELANGANA",
  "TRIPURA",
  "UTTAR PRADESH",
  "UTTARAKHAND",
  "WEST BENGAL",
  "ANDAMAN AND NICOBAR ISLANDS",
  "CHANDIGARH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
  "DELHI",
  "JAMMU AND KASHMIR",
  "LADAKH",
  "LAKSHADWEEP",
  "PUDUCHERRY",
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

/**
 * Full-name variant aliases only – NO 2-letter abbreviations (MP/WB etc)
 * per requirement: they appear inside other words too often.
 */
const STATE_ALIASES: Record<string, string[]> = {
  "ODISHA": ["ORISSA"],
  "PUDUCHERRY": ["PONDICHERRY", "PONDICHERY"],
  "ANDAMAN AND NICOBAR ISLANDS": ["ANDAMAN & NICOBAR", "ANDAMAN NICOBAR"],
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": [
    "DADRA AND NAGAR HAVELI",
    "DAMAN AND DIU",
    "DADRA & NAGAR HAVELI",
  ],
  "JAMMU AND KASHMIR": ["JAMMU & KASHMIR", "JAMMU KASHMIR"],
  "CHHATTISGARH": ["CHATTISGARH", "CHATISGARH", "CHHATISGARH"],
  // common joined forms seen in addresses
  "TAMIL NADU": ["TAMILNADU"],
  "ANDHRA PRADESH": ["ANDHRA PRADESH"],
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic keyword extraction from CONSIGNEE ADDRESS.
 * Returns canonical UPPER state or null.
 * Uses word-boundary \b matching, longest names first.
 */
export function extractStateFromAddress(
  address: string | null | undefined,
): IndianState | null {
  if (!address || typeof address !== "string" || !address.trim()) return null;

  const normalized = address; // keep original for regex with \b, use case-insensitive flag

  // Build variant -> canonical map, sorted by variant length desc for longest-first match
  const variantToCanonical: { variant: string; canonical: IndianState }[] = [];

  for (const canonical of INDIAN_STATES) {
    variantToCanonical.push({ variant: canonical, canonical });
    const aliases = STATE_ALIASES[canonical];
    if (aliases) {
      for (const a of aliases) {
        variantToCanonical.push({ variant: a, canonical });
      }
    }
  }

  variantToCanonical.sort((a, b) => b.variant.length - a.variant.length);

  for (const { variant, canonical } of variantToCanonical) {
    const pattern = new RegExp(`\\b${escapeRegex(variant)}\\b`, "i");
    if (pattern.test(normalized)) {
      return canonical;
    }
  }

  return null;
}

// AI fallback – constrained to INDIAN_STATES + UNKNOWN
const stateAiSchema = z.object({
  state: z
    .string()
    .describe(
      `The Indian State/UT from allowed list: ${INDIAN_STATES.join(", ")}. If not detectable return "UNKNOWN".`,
    ),
  confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the state extraction"),
});

async function aiExtractState(
  address: string,
  extraContext?: { consigneeName?: string | null; partyName?: string | null; deliveryDestination?: string | null },
): Promise<IndianState | null> {
  if (!VALIDATION_ENABLED || !OPENAI_KEY) return null;
  if (!address || typeof address !== "string" || !address.trim()) return null;

  const contextParts: string[] = [];
  if (extraContext?.consigneeName?.trim()) contextParts.push(`Consignee Name: "${extraContext.consigneeName.trim()}"`);
  if (extraContext?.partyName?.trim()) contextParts.push(`Party Name: "${extraContext.partyName.trim()}"`);
  if (extraContext?.deliveryDestination?.trim()) contextParts.push(`Delivery Destination: "${extraContext.deliveryDestination.trim()}"`);
  const contextBlock = contextParts.length > 0 ? "\nAdditional hints (use only to disambiguate village/district, primary is still Consignee Address):\n" + contextParts.join("\n") : "";

  try {
    const result = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({ schema: stateAiSchema }),
      system: `You are an expert Indian geocoding assistant for industrial supply invoices.

GOAL: Return the single correct Indian State/Union Territory for the given CONSIGNEE ADDRESS.
You MUST choose one of the 36 allowed values, even with low geographic evidence — only return UNKNOWN if the address is literally empty or contains zero location tokens (e.g., "M/s XYZ Pvt Ltd" with no village/city/district/pincode).

Allowed States/UTs (exact UPPER, must be one of):
${INDIAN_STATES.join(", ")}

INFERENCE RULES (apply in order):
1. Explicit state/UT string in address → return its canonical form.
2. City / District / Village → state: Use exhaustive India district→state knowledge. Never return UNKNOWN when any Indian location token exists.
   Examples: Pune/Nashik/Nagpur/Mumbai → MAHARASHTRA; Lalitpur/Lucknow/Kanpur/Azamgarh/Mau/Satiyava/Fakhruddinpur → UTTAR PRADESH; Kuarpur/Bariyarpur/Ajaygarh/Panna/Satna/Rewa → MADHYA PRADESH; Howrah/Kolkata/Durgapur → WEST BENGAL; Bhopal/Indore/Jabalpur → MADHYA PRADESH; Bhubaneswar/Cuttack/Balasore → ODISHA; Ahmedabad/Surat/Vadodara → GUJARAT; Chennai/Coimbatore → TAMIL NADU; Hyderabad/Warangal → TELANGANA.
3. Village-only address: infer district from village + road + company co-occurrence. Even if village name is ambiguous, pick the most populous state that contains that village and return low confidence — DO NOT return UNKNOWN. E.g., "Village - Kuarpur, Bariyarpur road, Ajaygarh" → MADHYA PRADESH (Ajaygarh is Panna district, MP) even without explicit state.
4. Abbreviations like "UP / MP / WB / AP" inside address ARE valid supporting hints when accompanied by nearby district tokens — treat as evidence, not noise.
5. Pincode prefix and district co-occurrence is valid evidence (e.g., 47xxxx → MP, 27xxxx/28xxxx → UP, 45xxxx → MP, 12xxxx → HARYANA).
6. Prefer low-confidence guess over UNKNOWN. Only return UNKNOWN if the string is empty or has no village/city/district/state/pincode token at all.
7. India only. Return ONLY canonical allowed value or UNKNOWN, never abbreviations.

FEW-SHOTS:
- "MASORA LALITPUR LUCKNOW LALITPUR" → UTTAR PRADESH (high) — Lalitpur is UP district
- "Village - Kuarpur, Bariyarpur road, Ajaygarh" → MADHYA PRADESH (medium) — Ajaygarh in Panna, MP
- "Vill:Fakhruddinpur PO: Satiyava, Near Purvanchal E Satiyava" → UTTAR PRADESH (medium) — Satiyava is Azamgarh/Mau belt, UP
- "307, Swaika Centre, Pollock Street, Kolkata," → WEST BENGAL (high)
- "Plot 12, Pune 411045" → MAHARASHTRA (high)
- "M/s Sudhakara Infratech Pvt Ltd" (no location token) → UNKNOWN (low)`,
      prompt: `Consignee Address: "${address.trim()}"${contextBlock}`,
      temperature: 0,
    });

    const raw = (result.output as { state?: string })?.state?.trim();
    if (!raw) return null;
    const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
    if (upper === "UNKNOWN" || upper === "NOT DETECTABLE" || upper === "NOT FOUND") return null;

    // Validate against allow-list (exact match)
    const matched = (INDIAN_STATES as readonly string[]).find((s) => s === upper);
    if (matched) return matched as IndianState;

    // Try to normalize minor AI deviations (e.g., "ANDAMAN & NICOBAR ISLANDS" → canonical)
    // Check alias reverse map
    for (const canonical of INDIAN_STATES) {
      if (canonical === upper) return canonical;
      const aliases = STATE_ALIASES[canonical];
      if (aliases && aliases.some((a) => a.toUpperCase() === upper)) return canonical;
    }

    // Special: AI might return "ORISSA" → map to ODISHA
    if (upper === "ORISSA") return "ODISHA";
    if (upper === "PONDICHERRY" || upper === "PONDICHERY") return "PUDUCHERRY";

    return null;
  } catch (err) {
    console.warn(`[SupplyStateAI] Failed for "${address.slice(0, 80)}": ${(err as Error).message}`);
    return null;
  }
}

/**
 * Main resolver: keyword first, AI fallback if keyword misses.
 */
export async function resolveSupplyState(
  address: string | null | undefined,
  extraContext?: { consigneeName?: string | null; partyName?: string | null; deliveryDestination?: string | null },
): Promise<IndianState | null> {
  const keyword = extractStateFromAddress(address);
  if (keyword) return keyword;

  if (!address || !address.trim()) return null;

  const ai = await aiExtractState(address.trim(), extraContext);
  return ai;
}
