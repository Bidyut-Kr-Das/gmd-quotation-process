"use server";

import { openai } from "@ai-sdk/openai";
import { generateText, APICallError, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAiFeedbackContext } from "@/lib/ai-feedback";
import { logActivity, requireUser, withLog } from "@/lib/activity-logger";
import { publishAiRelevanceTask } from "@/lib/queue/publisher";
// import { publishAgentRelevanceTask } from "@/lib/queue/publisher";

const model = openai("gpt-5-mini");

export async function analyzeContent(prompt: string) {
  const { text } = await generateText({
    model,
    prompt,
  });
  return text;
}

export async function analyzeContentWithSystem(system: string, prompt: string) {
  const { text } = await generateText({
    model,
    system,
    prompt,
  });
  return text;
}

type TenderAnalysisResult =
  | { success: true; data: { valid: boolean; reason: string } }
  | { success: false; error: "rate_limit" | "unknown" };

const BASE_SYSTEM_PROMPT = `You are a Tender Evaluation Expert.

Determine whether the following tender brief is specifically for the SUPPLY of valves or valve-related products, and rate how relevant it is.

Eligible Products (ONLY these)

Valves
- Sluice Valves / Gate Valves
- Butterfly Valves
- Air Valves (Kinetic Air Valves, Double Orifice Air Valves, Single Orifice Air Valves, Air Release Valves)
- Non-Return Valves / Reflux Valves / Check Valves
- Dual Plate Check Valves (DPCV)
- Swing Check Valves
- Ball Valves
- Globe Valves
- Plug Valves
- Pressure Reducing Valves (PRV)
- Pressure Relief Valves / Safety Valves
- Zero Velocity Valves
- Foot Valves
- Knife Gate Valves
- Diaphragm Valves
- Pinch Valves
- Control Valves

Valve-Related Products
- Dismantling Joints
- Valve accessories, actuators, gearboxes and associated fittings, ONLY when supplied together with valves

Strict Inclusion Rules
1. The tender must explicitly involve the supply, procurement, purchase, or delivery of one or more of the above products.
2. Do not decide from the tender title alone. Analyze the title, description, BOQ / item descriptions, technical specifications, scope of supply, and any available tender documents.
3. Consider synonyms and technical terminology, not only exact keyword matches (e.g. "NRV", "reflux valve", "sluice gate valve", "kinetic air valve", "DPCV", "pressure reducing station" with PRVs supplied).
4. If the products supplied are not from the list above, answer false.

Relevance Levels
- HIGH: valves or valve-related products are the main item of the tender.
- MEDIUM: valves form a significant supplied part of a larger water supply, pipeline, pumping, irrigation, sewerage or other infrastructure tender (e.g. valves appear as substantial BOQ line items to be supplied).
- NONE: the tender does not qualify (see exclusions).

Explicit Exclusions

Always answer false (relevance "NONE") if:
- Valves are mentioned only for repair, servicing, overhauling, AMC, manpower, or general maintenance.
- The work is installation-only, erection-only, testing/commissioning-only, consultancy, or services, with no supply of valves included.
- "Valve" appears only incidentally in specifications or general conditions and no valve procurement is required.
- The tender is for a product not on the eligible list (e.g. pipes, pumps, meters, or fittings alone, with no eligible valves supplied).

Output Format

Respond with a single JSON object containing exactly these three fields:
- "valid": a boolean. true if the tender involves actual supply of eligible valves/valve-related products (HIGH or MEDIUM relevance), false otherwise.
- "relevance": one of "HIGH", "MEDIUM", or "NONE".
- "reason": one concise sentence (plain text) explaining the decision, naming the valve type(s) supplied where applicable.

Do NOT use "ANSWER:", "REASON:", or any other labels/prefixes inside the "reason" value.
Important: Set "valid" to true only when the tender clearly involves the supply/procurement of one or more eligible products. In every other case, set "valid" to false and "relevance" to "NONE".`;

export async function analyzeTenderValidity(
  tenderBrief: string,
): Promise<TenderAnalysisResult> {
  try {
    const feedbackContext = await getAiFeedbackContext();
    const system = BASE_SYSTEM_PROMPT + feedbackContext;

    const { output } = await generateText({
      model,
      system,
      output: Output.object({
        schema: z.object({
          valid: z
            .boolean()
            .describe(
              "true if the tender is specifically for the supply of eligible cables/conductors, false otherwise",
            ),
          reason: z
            .string()
            .describe(
              "One concise plain-text sentence explaining the decision. No ANSWER:/REASON: labels or prefixes.",
            ),
        }),
        name: "tenderValidity",
        description:
          "Whether the tender is specifically for the supply of eligible power/control cables or conductors",
      }),
      prompt: `Analyze this tender brief:\n\n${tenderBrief}`,
    });

    const reason = output.reason
      .replace(/^ANSWER:\s*(YES|NO)\s*/i, "")
      .replace(/^REASON:\s*/i, "")
      .trim();
    return { success: true, data: { valid: output.valid, reason } };
  } catch (error) {
    console.error(error);
    if (APICallError.isInstance(error) && error.statusCode === 429) {
      return { success: false, error: "rate_limit" };
    }
    return { success: false, error: "unknown" };
  }
}

export async function saveAiRelevance(params: {
  tenderMergedId: number;
  valid: boolean;
  reason: string;
}) {
  await requireUser();
  const data = {
    aiRelevanceValid: params.valid,
    aiRelevanceReason: params.reason,
  };
  await prisma.tenderMerged.update({
    where: { id: params.tenderMergedId },
    data,
  });
  const referenceNo = (
    await prisma.tenderMerged.findUnique({
      where: { id: params.tenderMergedId },
      select: { referenceNo: true },
    })
  )?.referenceNo;

  logActivity({
    action: "UPDATE",
    tableName: "TenderMerged",
    recordId: String(params.tenderMergedId),
    referenceNo: referenceNo ?? undefined,
    details: `Set AI relevance valid=${params.valid} on tender #${params.tenderMergedId}`,
  });
}

export const publishAiAnalysisJob = withLog(
  async (params: {
    referenceNo: string;
    tenderBrief: string;
    itemCategory: string;
  }) => {
    await requireUser();
    return publishAiRelevanceTask({
      payloadType: "analysis",
      referenceNo: params.referenceNo,
      company: "gmd",
      category: "valve",
      tenderbrief: params.tenderBrief,
      itemcategory: params.itemCategory,
      // client_id: process.env.TENDER_AGENT_CLIENT_ID ?? "",
    });
  },
  (result, params) => ({
    action: "CREATE",
    tableName: "agent:relevance",
    referenceNo: params.referenceNo,
    details: `Queued AI analysis job for ${params.referenceNo} (published=${result})`,
  }),
);
