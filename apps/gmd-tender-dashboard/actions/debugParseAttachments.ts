"use server";

import { prisma } from "@/lib/prisma";
import { parseAttachmentExcel, type ParsedExcelOutput } from "./parseAttachment";

export interface AttachmentParseResult {
  docketNo: string | null;
  attachmentUrl: string;
  fileName?: string;
  sheets?: ParsedExcelOutput["sheets"];
  error?: string;
}

export async function debugParseAllAttachments(): Promise<AttachmentParseResult[]> {
  if (!prisma) {
    throw new Error("Database not available");
  }

  const tenders = await prisma.tender.findMany({
    where: {
      attachmentUrl: { not: null },
      NOT: { attachmentUrl: "-" },
    },
    select: { id: true, docketNo: true, attachmentUrl: true },
    orderBy: { slNo: "asc" },
  });

  const results: AttachmentParseResult[] = [];

  for (const t of tenders) {
    if (!t.attachmentUrl || t.attachmentUrl === "-") continue;

    try {
      const parsed: ParsedExcelOutput = await parseAttachmentExcel(t.attachmentUrl);
      results.push({
        docketNo: t.docketNo,
        attachmentUrl: t.attachmentUrl,
        fileName: parsed.fileName,
        sheets: parsed.sheets,
      });
    } catch (err) {
      results.push({
        docketNo: t.docketNo,
        attachmentUrl: t.attachmentUrl,
        error: (err as Error).message,
      });
    }
  }

  return results;
}
