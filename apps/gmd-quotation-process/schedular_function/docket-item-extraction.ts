/**
 * Item extraction orchestrator for the `docket-creation` job.
 *
 * Strategy: the deterministic parser (`docket-item-parser.ts`) runs first over
 * the subject, every message body, the attachment OCR text and the attachment
 * text. Only when it finds **nothing** does an opt-in AI fallback run.
 *
 * The fallback is off unless `AI_FALLBACK_ENABLED=true` and `OPENAI_API_KEY` is
 * set; it uses the repo's standard structured-output pattern (strict zod schema,
 * `temperature: 0`) and drops any item without a stated quantity, matching the
 * parser's contract.
 */

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { parseDocketItems, type ParsedDocketItem } from "./docket-item-parser";
import { collectAttachmentTexts } from "./docket-attachments";

export interface DocketItemExtractionInput {
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  ocrText?: string | null;
  attachNames?: unknown;
  attachLinks?: unknown;
}

export interface DocketItemExtractionResult {
  items: ParsedDocketItem[];
  source: "parser" | "ai" | "none";
  /** Items the deterministic parser found before any fallback. */
  parserItems: number;
  aiUsed: boolean;
  attachmentFailures: number;
  attachmentSkipped: number;
}

const MAX_AI_INPUT_CHARS = 40_000;

const aiItemSchema = z.object({
  items: z
    .array(
      z.object({
        itemName: z.string().describe("The item description exactly as written in the mail; do not expand abbreviations."),
        quantity: z.coerce.number().describe("The numeric quantity stated for this item."),
      }),
    )
    .describe("Only the line items explicitly requested with an explicit quantity. Exclude headers, totals, rates, signatures and quoted history."),
});

function aiFallbackEnabled(): boolean {
  const flag = (process.env.AI_FALLBACK_ENABLED ?? "").trim().toLowerCase();
  return (flag === "true" || flag === "1") && !!process.env.OPENAI_API_KEY;
}

function buildAiInput(input: DocketItemExtractionInput, attachmentTexts: string[]): string {
  const parts: string[] = [];
  if (input.subject) parts.push(`SUBJECT: ${input.subject}`);
  if (input.bodyPreview) parts.push(`FIRST MESSAGE:\n${input.bodyPreview}`);
  if (input.body) parts.push(`THREAD:\n${input.body}`);
  if (input.ocrText) parts.push(`ATTACHMENT OCR:\n${input.ocrText}`);
  for (const text of attachmentTexts) parts.push(`ATTACHMENT TEXT:\n${text}`);
  const joined = parts.join("\n\n---\n\n");
  return joined.length > MAX_AI_INPUT_CHARS ? joined.slice(0, MAX_AI_INPUT_CHARS) : joined;
}

async function aiExtract(text: string): Promise<ParsedDocketItem[]> {
  if (!text.trim()) return [];

  const result = await generateText({
    model: openai(process.env.AI_EXTRACTION_MODEL || "gpt-4o-mini"),
    output: Output.object({ schema: aiItemSchema }),
    system: `You extract line items from industrial quotation enquiry emails (valves, pipes, fittings) for GMD.

GOAL: return every line item the customer explicitly requested, with its quantity.

RULES:
- Return itemName EXACTLY as written. Do NOT expand abbreviations, add size/type/material, or rephrase.
- Only include an item when an explicit quantity is stated ("2 Nos", "Qty: 5", "3 sets"). Drop items with no quantity.
- Exclude table headers, column titles, totals/subtotals, rates, prices, GST/HSN, delivery/payment terms, signatures, disclaimers and quoted reply history.
- Do not invent items. If nothing qualifies, return an empty list.
- Return only the requested JSON.`,
    prompt: text,
    temperature: 0,
  });

  const raw = result.output?.items ?? [];
  return raw
    .map((i) => ({ itemName: String(i.itemName ?? "").trim(), quantity: Number(i.quantity) }))
    .filter((i) => i.itemName.length >= 2 && Number.isFinite(i.quantity) && i.quantity > 0 && i.quantity <= 1_000_000)
    .slice(0, 500);
}

/**
 * Extracts `{ itemName, quantity }` candidates for one thread.
 *
 * Never throws for attachment problems; only a parser/AI internal error is
 * swallowed and reported as an empty result.
 */
export async function extractDocketItems(
  input: DocketItemExtractionInput,
): Promise<DocketItemExtractionResult> {
  const bodies = [input.body, input.bodyPreview].filter((b): b is string => !!b);
  const attachments = await collectAttachmentTexts(input.attachNames, input.attachLinks);

  const parserItems = parseDocketItems({
    bodies,
    ocrText: input.ocrText,
    attachmentTexts: attachments.texts,
  });

  if (parserItems.length > 0) {
    return {
      items: parserItems,
      source: "parser",
      parserItems: parserItems.length,
      aiUsed: false,
      attachmentFailures: attachments.failures,
      attachmentSkipped: attachments.skipped,
    };
  }

  if (aiFallbackEnabled()) {
    try {
      const aiItems = await aiExtract(buildAiInput(input, attachments.texts));
      if (aiItems.length > 0) {
        return {
          items: aiItems,
          source: "ai",
          parserItems: 0,
          aiUsed: true,
          attachmentFailures: attachments.failures,
          attachmentSkipped: attachments.skipped,
        };
      }
    } catch (e) {
      console.warn("[docket-item-extraction] AI fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    items: [],
    source: "none",
    parserItems: 0,
    aiUsed: false,
    attachmentFailures: attachments.failures,
    attachmentSkipped: attachments.skipped,
  };
}
