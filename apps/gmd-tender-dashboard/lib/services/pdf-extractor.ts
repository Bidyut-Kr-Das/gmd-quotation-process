import { openai } from "@ai-sdk/openai";
import { generateText, Output, APICallError } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPdfDataUrl } from "@/lib/services/pdf-parser";

const model = openai("gpt-4o-mini");

const extractionSchema = z.object({
  itemCategory: z
    .string()
    .describe("Item category extracted from the tender PDF"),
  totalQuantity: z
    .string()
    .describe("Total quantity as mentioned in the tender PDF"),
  reportings: z
    .array(
      z.object({
        officer: z.string().describe("Consignee/Reporting officer name"),
        address: z
          .string()
          .describe("Address of the reporting officer/consignee"),
        quantity: z
          .string()
          .describe("Quantity allocated to this officer/consignee"),
      }),
    )
    .describe(
      "List of all consignees/reporting officers with their addresses and allocated quantities",
    ),
  size: z.array(
    z.object({
      itemCategory: z
        .string()
        .describe("Item category extracted from tender pdf"),
      TechnicalSpecifications: z
        .string()
        .describe(
          "Technical specification table in markdown table format for this item cateogry ",
        ),
    }),
  ),
});

export type ExtractionResult =
  | { success: true; data: z.infer<typeof extractionSchema> }
  | { success: false; error: "rate_limit" | "no_pdf_url" | "unknown" };

async function updateStatus(
  tenderId: number,
  parseStatus: string,
  parseError?: string | null,
) {
  try {
    await prisma.tenderMerged.update({
      where: { id: tenderId },
      data: { parseStatus, parseError: parseError ?? null },
    });
  } catch {}
}

function parseRetryAfter(message: string): number | null {
  const match = message.match(/try again in ([\d.]+)s/);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 1000;
  return null;
}

export async function extractPdfData(
  tenderId: number,
): Promise<ExtractionResult> {
  await updateStatus(tenderId, "PROCESSING");

  try {
    const tender = await prisma.tenderMerged.findUnique({
      where: { id: tenderId },
      select: { id: true, tenderFileUrl: true, referenceNo: true },
    });

    if (!tender?.tenderFileUrl) {
      await updateStatus(tenderId, "FAILED", "No file URL");
      return { success: false, error: "no_pdf_url" };
    }

    const pdfDataUrl = await getPdfDataUrl(tender.tenderFileUrl);
    if (!pdfDataUrl) {
      await updateStatus(tenderId, "FAILED", "Invalid Google Drive URL");
      return { success: false, error: "no_pdf_url" };
    }

    const MAX_RETRIES = 3;
    let output: z.infer<typeof extractionSchema> | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await generateText({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Extract the following from this tender PDF:\n" +
                    "1. Item Category — what category of items is being procured\n" +
                    "2. Total Quantity — the total quantity across all line items\n" +
                    "3. Consignees / Reporting Officers — list each officer name, their address, and the quantity allocated to them\n\n" +
                    "4. For each Item category - detailed breakdown of technical specifications. including specification, specification name, bid requirement.\n" +
                    "Return ALL consignees found. If address is not clearly mentioned, provide the best available location.",
                },
                {
                  type: "file",
                  mediaType: "application/pdf",
                  data: pdfDataUrl,
                },
              ],
            },
          ],
          output: Output.object({ schema: extractionSchema }),
        });
        output = result.output;
        break;
      } catch (error) {
        if (APICallError.isInstance(error) && error.statusCode === 429) {
          if (attempt < MAX_RETRIES) {
            const waitMs = parseRetryAfter(error.message) || 60_000;
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          await updateStatus(tenderId, "RATE_LIMITED", error.message);
          return { success: false, error: "rate_limit" };
        }
        lastError = error;
        break;
      }
    }

    if (!output) {
      throw lastError ?? new Error("Failed to extract PDF data");
    }

    try {
      console.log(
        `PDF Parse Result [tender ${tenderId} / ${tender.referenceNo}]:`,
        JSON.stringify(output, null, 2),
      );
    } catch {}

    const size =
      output.size
        ?.map((s) => `### ${s.itemCategory}\n${s.TechnicalSpecifications}`)
        .join("\n\n") || null;

    await prisma.$transaction([
      prisma.tenderMerged.update({
        where: { id: tenderId },
        data: {
          parseStatus: "COMPLETED",
          parseError: null,
          itemCategory: output.itemCategory,
          totalQuantity: output.totalQuantity,
          size,
        },
      }),
      prisma.reporting.deleteMany({ where: { tenderMergedId: tenderId } }),
      ...output.reportings.map((r) =>
        prisma.reporting.create({
          data: {
            tenderMergedId: tenderId,
            officer: r.officer,
            address: r.address || null,
            quantity: r.quantity || null,
          },
        }),
      ),
    ]);

    return { success: true, data: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updateStatus(tenderId, "FAILED", message);
    try {
      console.error(`PDF Parse failed [tender ${tenderId}]:`, error);
    } catch {}
    return { success: false, error: "unknown" };
  }
}
