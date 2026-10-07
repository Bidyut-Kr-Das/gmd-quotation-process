import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import * as XLSX from "xlsx";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import {
  hasReferenceNoColumn,
  findHeaderRowIndex,
  getReferenceNo,
  getFieldValue,
  buildMergedColumnMap,
} from "@/lib/tender-columns";
import { withLog } from "@/lib/activity-logger";

const SHEET_CONCURRENCY = 3;
const COMPETITORS_SEPARATOR = " - ";

const RESULT_FIELDS = [
  "ourRank",
  "ourValue",
  "nameOfRank1",
  "valueOfRank1",
  "differenceBetweenRank1",
  "nameOfRank2",
  "valueOfRank2",
  "differenceBetweenRank2",
] as const;

interface RejectedRow {
  fileName: string;
  sheetName: string;
  reason: string;
  row: Record<string, unknown>;
}

interface SheetResult {
  sheetName: string;
  count: number;
  excludedCount: number;
  errors: string[];
  skipped: boolean;
  rejected: RejectedRow[];
}

interface FileResult {
  fileName: string;
  fileId: number;
  sheets: SheetResult[];
  totalCount: number;
  totalErrors: string[];
  excludedCount: number;
  rejected: RejectedRow[];
}

interface UpdateItem {
  refNo: string;
  updateData: Record<string, unknown>;
  competitors: string;
  row: Record<string, unknown>;
}

interface ParsedSheet {
  sheetName: string;
  updates: UpdateItem[];
  skipped: boolean;
  rejected: RejectedRow[];
}

function parseSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
  mergedColumnMap: Record<string, string>,
): ParsedSheet {
  const sheet = workbook.Sheets[sheetName];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  if (!rawRows.length) {
    return { sheetName, updates: [], skipped: true, rejected: [] };
  }

  const headerRowIdx = findHeaderRowIndex(rawRows);
  if (headerRowIdx < 0) {
    return { sheetName, updates: [], skipped: true, rejected: [] };
  }

  const headers = (rawRows[headerRowIdx] as unknown[])
    .map((h) => (h == null ? "" : String(h).trim()))
    .filter(Boolean);

  if (!hasReferenceNoColumn(headers, mergedColumnMap)) {
    return { sheetName, updates: [], skipped: true, rejected: [] };
  }

  const jsonData: Record<string, unknown>[] = rawRows
    .slice(headerRowIdx + 1)
    .map((row) => {
      const obj: Record<string, unknown> = {};
      const headerRow = rawRows[headerRowIdx] as unknown[];
      headerRow.forEach((h, i) => {
        if (h) obj[String(h).trim()] = row[i] ?? "";
      });
      return obj;
    });

  const updates: UpdateItem[] = [];
  const rejected: RejectedRow[] = [];

  for (const row of jsonData) {
    const refNo = getReferenceNo(row, headers, mergedColumnMap) || "";
    if (!refNo) {
      rejected.push({
        fileName,
        sheetName,
        reason: "Missing reference number",
        row,
      });
      continue;
    }

    const updateData: Record<string, unknown> = {};
    for (const field of RESULT_FIELDS) {
      const value = getFieldValue(row, headers, field, mergedColumnMap);
      if (value != null && String(value).trim() !== "") {
        updateData[field] = String(value).trim();
      }
    }

    const competitorsRaw = getFieldValue(row, headers, "competitors", mergedColumnMap);
    const competitors = competitorsRaw != null ? String(competitorsRaw).trim() : "";

    if (Object.keys(updateData).length === 0 && !competitors) {
      rejected.push({
        fileName,
        sheetName,
        reason: "No result fields present",
        row,
      });
      continue;
    }

    updates.push({ refNo, updateData, competitors, row });
  }

  return { sheetName, updates, skipped: false, rejected };
}

async function processResultFile(file: File): Promise<FileResult & { updatedRefs: string[] }> {
  const fileResult: FileResult & { updatedRefs: string[] } = {
    fileName: file.name,
    fileId: 0,
    sheets: [],
    totalCount: 0,
    totalErrors: [],
    excludedCount: 0,
    rejected: [],
    updatedRefs: [],
  };

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const dbMappingRows = await prisma.columnMapping.findMany({
    where: { status: "active" },
  });
  const mergedColumnMap = buildMergedColumnMap(dbMappingRows);

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const limit = pLimit(SHEET_CONCURRENCY);

  const sheetTasks = workbook.SheetNames.map((sheetName) =>
    limit(async () => {
      const parsed = parseSheetData(workbook, sheetName, file.name, mergedColumnMap);

      const sheetResult: SheetResult = {
        sheetName: parsed.sheetName,
        count: 0,
        excludedCount: 0,
        errors: [],
        skipped: parsed.skipped,
        rejected: parsed.rejected,
      };

      if (parsed.skipped || parsed.updates.length === 0) return sheetResult;

      const refNos = parsed.updates.map((u) => u.refNo);

      const existingRecords = await prisma.tenderMerged.findMany({
        where: { referenceNo: { in: refNos } },
        select: { id: true, referenceNo: true, competitors: true },
      });

      const existingMap = new Map(existingRecords.map((r) => [r.referenceNo, r]));

      for (const item of parsed.updates) {
        const existing = existingMap.get(item.refNo);

        if (!existing) {
          sheetResult.rejected.push({
            fileName: file.name,
            sheetName: parsed.sheetName,
            reason: "Reference not found in tender_merged",
            row: item.row,
          });
          continue;
        }

        const data: Record<string, unknown> = { ...item.updateData };

        if (item.competitors) {
          const existingComp = (existing.competitors ?? "").toString().trim();
          const seen = new Set(
            existingComp
              ? existingComp.split(COMPETITORS_SEPARATOR).map((s) => s.trim()).filter(Boolean)
              : [],
          );
          const newParts = item.competitors
            .split(COMPETITORS_SEPARATOR)
            .map((s) => s.trim())
            .filter(Boolean);
          const toAdd = newParts.filter((p) => !seen.has(p));
          if (toAdd.length) {
            data.competitors = existingComp
              ? `${existingComp}${COMPETITORS_SEPARATOR}${toAdd.join(COMPETITORS_SEPARATOR)}`
              : toAdd.join(COMPETITORS_SEPARATOR);
          }
        }

        if (Object.keys(data).length === 0) continue;

        try {
          await prisma.tenderMerged.update({
            where: { id: existing.id },
            data,
          });
          sheetResult.count++;
          fileResult.updatedRefs.push(item.refNo);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          sheetResult.errors.push(`Row ${item.refNo}: ${errorMessage}`);
          sheetResult.rejected.push({
            fileName: file.name,
            sheetName: parsed.sheetName,
            reason: `Update failed: ${errorMessage}`,
            row: item.row,
          });
        }
      }

      return sheetResult;
    }),
  );

  const sheetResults = await Promise.all(sheetTasks);
  fileResult.sheets = sheetResults;

  for (const s of sheetResults) {
    fileResult.totalCount += s.count;
    fileResult.totalErrors.push(...s.errors);
    fileResult.rejected.push(...s.rejected);
  }

  return fileResult;
}

const processResultFileWithLog = withLog(
  processResultFile,
  (result) => ({
    action: "UPDATE" as const,
    tableName: "TenderMerged",
    recordId: result.updatedRefs.slice(0, 50).join(",") || undefined,
    details: `Upload result: ${result.updatedRefs.length} updated, ${result.rejected.length} rejected from ${result.fileName}`,
  }),
);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized! Login to continue." },
      { status: 401 },
    );
  }
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results: FileResult[] = [];

    for (const file of files) {
      const fileResult = await processResultFileWithLog(file);
      results.push(fileResult);
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    try { console.error("Upload result error:", error); } catch {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
