import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import * as XLSX from "xlsx";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import {
  MERGED_FIELDS,
  mapRowToTender,
  hasReferenceNoColumn,
  findHeaderRowIndex,
  getReferenceNo,
  isGemReference,
  parseDate,
  getFieldValue,
  buildMergedColumnMap,
} from "@/lib/tender-columns";
import { sendTenderWebhook } from "@/lib/webhook";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";
import { format } from "date-fns";

const SHEET_CONCURRENCY = 3;
const INSERT_BATCH_SIZE = 50;
const TX_TIMEOUT = 10 * 60 * 1000;

const OVERWRITE_FIELDS = new Set([
  "nameOfRank1", "valueOfRank1", "differenceBetweenRank1",
  "nameOfRank2", "valueOfRank2", "differenceBetweenRank2",
  "ourRank", "ourValue",
]);
const COMPETITORS_SEPARATOR = " - ";

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

interface PreparedTender {
  refNo: string;
  tenderType: "GEM" | "NON_GEM";
  createData: Record<string, unknown>;
  originalRow: Record<string, unknown>;
}

interface ParsedSheet {
  sheetName: string;
  prepared: PreparedTender[];
  skipped: boolean;
  excludedCount: number;
  rejected: RejectedRow[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildCreateData(
  row: Record<string, unknown>,
  headers: string[],
  fileId: number,
  excludedCategory: string | null,
  customColumnMap?: Record<string, string>,
  associations?: { id: number; name: string; email: string }[],
): { refNo: string; tenderType: "GEM" | "NON_GEM"; createData: Record<string, unknown> } {
  const refNo = getReferenceNo(row, headers, customColumnMap) || "";
  const { knownFields, extraFields } = mapRowToTender(row, MERGED_FIELDS, customColumnMap);
  const tenderType: "GEM" | "NON_GEM" = isGemReference(refNo) ? "GEM" : "NON_GEM";

  const createData: Record<string, unknown> = {
    fileId,
    referenceNo: refNo,
    tenderType,
    excludedCategory,
  };

  for (const [key, value] of Object.entries(knownFields)) {
    if (key !== "referenceNo") {
      createData[key] = value;
    }
  }

  const assignedValue = knownFields.assignedTo as string | undefined;
  if (assignedValue && associations) {
    const lowerValue = assignedValue.toLowerCase().trim();
    const matched = associations.find(
      (a) => a.name.toLowerCase() === lowerValue || a.email.toLowerCase() === lowerValue,
    );
    if (matched) {
      createData.tenderAssociations = {
        create: [{ associationId: matched.id }],
      };
    } else {
      const testUser = associations.find((a) => a.name.toLowerCase() === "test_user");
      if (testUser) {
        createData.tenderAssociations = {
          create: [{ associationId: testUser.id }],
        };
      }
    }
    delete createData.assignedTo;
  }

  if (extraFields.length) {
    createData.extraFields = {
      create: extraFields,
    };
  }

  return { refNo, tenderType, createData };
}

function parseSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
  cableKeywords: string[],
  conductorsKeywords: string[],
  today: Date,
  customColumnMap?: Record<string, string>,
  associations?: { id: number; name: string; email: string }[],
): ParsedSheet {
  const sheet = workbook.Sheets[sheetName];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  if (!rawRows.length) {
    return {
      sheetName,
      prepared: [],
      skipped: true,
      excludedCount: 0,
      rejected: [],
    };
  }

  const headerRowIdx = findHeaderRowIndex(rawRows);
  if (headerRowIdx < 0) {
    return {
      sheetName,
      prepared: [],
      skipped: true,
      excludedCount: 0,
      rejected: [],
    };
  }

  const headers = (rawRows[headerRowIdx] as unknown[])
    .map((h) => (h == null ? "" : String(h).trim()))
    .filter(Boolean);

  console.log(`[UPLOAD] Headers for sheet "${sheetName}":`, headers);

  if (!hasReferenceNoColumn(headers, customColumnMap)) {
    return {
      sheetName,
      prepared: [],
      skipped: true,
      excludedCount: 0,
      rejected: [],
    };
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

  const prepared: PreparedTender[] = [];
  const rejected: RejectedRow[] = [];
  let excludedCount = 0;

  for (const row of jsonData) {
    const refNo = getReferenceNo(row, headers, customColumnMap) || "";
    if (!refNo) {
      rejected.push({
        fileName,
        sheetName,
        reason: "Missing reference number",
        row,
      });
      continue;
    }

    const tenderBrief = getFieldValue(row, headers, "tenderBrief", customColumnMap);
    const briefText =
      tenderBrief == null ? "" : String(tenderBrief).toLowerCase();

    const excludedCategories: string[] = [];

    const matchesCable =
      briefText.length > 0 &&
      cableKeywords.some((kw) => briefText.includes(kw));
    if (matchesCable) excludedCategories.push("cable");

    const matchesConductors =
      briefText.length > 0 &&
      conductorsKeywords.some((kw) => briefText.includes(kw));
    if (matchesConductors) excludedCategories.push("conductors");

    const deadlineRaw = getFieldValue(row, headers, "deadline", customColumnMap);
    const deadlineDate = deadlineRaw ? parseDate(deadlineRaw) : null;
    if (!deadlineDate) {
      const isEmpty = deadlineRaw == null || String(deadlineRaw).trim() === "";
      rejected.push({
        fileName,
        sheetName,
        reason: isEmpty ? "Missing deadline date" : "Invalid deadline date",
        row,
      });
      continue;
    }
    const isDateExcluded = deadlineDate.getTime() <= today.getTime();
    if (isDateExcluded) excludedCategories.push("date");

    const excludedCategory =
      excludedCategories.length > 0 ? excludedCategories.join(",") : null;

    if (excludedCategory !== null) excludedCount++;

    const { refNo: r, tenderType, createData } = buildCreateData(
      row,
      headers,
      0,
      excludedCategory,
      customColumnMap,
      associations,
    );
    console.log(
      `[UPLOAD] Deadline for ${r}:`,
      createData.deadline ? format(createData.deadline as Date, "do MMM yyyy") : "null",
    );
    prepared.push({ refNo: r, tenderType, createData, originalRow: row });
  }

  return {
    sheetName,
    prepared,
    skipped: false,
    excludedCount,
    rejected,
  };
}

async function insertTenderMerged(
  prepared: PreparedTender[],
  fileId: number,
  sheetResult: SheetResult,
  fileName: string,
): Promise<void> {
  if (!prepared.length) return;

  const refNos = prepared.map((p) => p.refNo);

  const existingRecords = await prisma.tenderMerged.findMany({
    where: { referenceNo: { in: refNos } },
    include: { tenderAssociations: { include: { association: true } } },
  });

  const existingMap = new Map(existingRecords.map((r) => [r.referenceNo, r]));

  const toCreate: Record<string, unknown>[] = [];
  const webhookQueue: string[] = [];
  const seenRefs = new Set<string>();
  const originalRowByRef = new Map<string, Record<string, unknown>>();

  for (const p of prepared) {
    const old = existingMap.get(p.refNo);
    if (old) {
      const updateData: Record<string, unknown> = {
        fileId,
      };

      const newDeadline = p.createData.deadline as Date | undefined;
      if (newDeadline && (!old.deadline || newDeadline.getTime() >= old.deadline.getTime())) {
        updateData.deadline = newDeadline;
      }

      if (p.createData.app && p.createData.app !== "NOT_DECIDED" && old.app === "NOT_DECIDED") {
        updateData.app = p.createData.app;
      }
      if (p.createData.aps && p.createData.aps !== "NOT_DECIDED" && old.aps === "NOT_DECIDED") {
        updateData.aps = p.createData.aps;
      }
      if (p.createData.apm && p.createData.apm !== "NOT_DECIDED" && old.apm === "NOT_DECIDED") {
        updateData.apm = p.createData.apm;
      }

      const SKIP_KEYS = new Set([
        "fileId", "referenceNo", "tenderType", "excludedCategory",
        "deadline", "app", "aps", "apm",
        "tenderAssociations", "extraFields",
      ]);

      for (const [key, value] of Object.entries(p.createData)) {
        if (SKIP_KEYS.has(key)) continue;

        if (key === "competitors") {
          const newValue = String(value).trim();
          if (newValue) {
            const existing = (old.competitors ?? "").toString().trim();
            const seen = new Set(
              existing
                ? existing.split(COMPETITORS_SEPARATOR).map((s) => s.trim()).filter(Boolean)
                : [],
            );
            if (!seen.has(newValue)) {
              updateData.competitors = existing
                ? `${existing}${COMPETITORS_SEPARATOR}${newValue}`
                : newValue;
            }
          }
          continue;
        }

        if (OVERWRITE_FIELDS.has(key)) {
          if (value != null && value !== "") {
            updateData[key] = value;
          }
          continue;
        }

        const oldVal = (old as any)[key];
        if ((oldVal == null || oldVal === "") && value != null && value !== "") {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.tenderMerged.update({
          where: { id: old.id },
          data: updateData as any,
        });
        // console.log(`[UPDATE] ${p.refNo} -> fields: ${Object.keys(updateData).join(", ")}`);
      } else {
        console.log(`[SKIP] ${p.refNo} - no changes`);
      }

      const addedAssociations = p.createData.tenderAssociations && old.tenderAssociations.length === 0;
      if (addedAssociations) {
        const assocData = p.createData.tenderAssociations as { create: { associationId: number }[] };
        await prisma.tenderAssociation.createMany({
          data: assocData.create.map((a) => ({
            tenderMergedId: old.id,
            associationId: a.associationId,
          })),
          skipDuplicates: true,
        });
      }

      const wasAlready = old.apm === "YES" && old.tenderAssociations.length > 0;
      const afterApm = (updateData.apm as string | undefined) ?? old.apm;
      const afterHasAssociations = addedAssociations || old.tenderAssociations.length > 0;
      if (!wasAlready && afterApm === "YES" && afterHasAssociations) {
        webhookQueue.push(old.referenceNo);
      }
    } else {
      const hasBrief =
        p.createData.tenderBrief != null &&
        String(p.createData.tenderBrief).trim() !== "";
      if (!hasBrief) {
        console.log(`[SKIP] ${p.refNo} - missing tender brief`);
        sheetResult.rejected.push({
          fileName,
          sheetName: sheetResult.sheetName,
          reason: "Missing tender brief",
          row: p.originalRow,
        });
        continue;
      }
      if (seenRefs.has(p.refNo)) {
        console.log(`[SKIP] Duplicate refNo in same batch: ${p.refNo}`);
        sheetResult.rejected.push({
          fileName,
          sheetName: sheetResult.sheetName,
          reason: "Duplicate reference number in batch",
          row: p.originalRow,
        });
        continue;
      }
      seenRefs.add(p.refNo);
      // console.log(`[INSERT] ${p.refNo}`);
      originalRowByRef.set(p.refNo, p.originalRow);
      toCreate.push({ ...p.createData, fileId });
      if (p.createData.apm === "YES" && p.createData.tenderAssociations) {
        webhookQueue.push(p.refNo);
      }
    }
  }

  const batches = chunk(toCreate, INSERT_BATCH_SIZE);

  for (const batch of batches) {
    try {
      await prisma.$transaction(
        batch.map((data) => prisma.tenderMerged.create({ data: data as any })),
        { timeout: TX_TIMEOUT },
      );
      sheetResult.count += batch.length;
    } catch (error) {
      console.error(error);

      for (const data of batch) {
        try {
          await prisma.tenderMerged.create({ data: data as any });
          sheetResult.count++;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          sheetResult.errors.push(
            `Row ${(data as any).referenceNo || "unknown"}: ${errorMessage}`,
          );
          const refNo = (data as any).referenceNo as string | undefined;
          const originalRow = refNo ? originalRowByRef.get(refNo) : undefined;
          sheetResult.rejected.push({
            fileName,
            sheetName: sheetResult.sheetName,
            reason: `Insert failed: ${errorMessage}`,
            row: originalRow ?? {},
          });
        }
      }
    }
  }

  if (webhookQueue.length > 0) {
    const tenders = await prisma.tenderMerged.findMany({
      where: { referenceNo: { in: webhookQueue } },
      include: { tenderAssociations: { include: { association: true } }, tenderFiles:true },
    });
    for (const t of tenders) {
      if (t.apm === "YES" && t.tenderAssociations.length > 0) {
        sendTenderWebhook(
          {
            referenceNo: t.referenceNo,
            itemCategory: t.itemCategory,
            organization: t.organization,
            deadline: t.deadline,
            tenderFileUrl:
                      t.tenderFiles.find((t) =>
                        t.tags.includes(TENDER_FILE_TYPES.TENDER_DOCUMENT),
                      )?.url ?? "",
          },
          t.tenderType === "GEM" ? "Gem" : "Non-Gem",
          t.tenderAssociations,
        );
      }
    }
  }
}

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
      const fileResult = await processFile(file);
      results.push(fileResult);
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

async function processFile(file: File): Promise<FileResult> {
  const fileResult: FileResult = {
    fileName: file.name,
    fileId: 0,
    sheets: [],
    totalCount: 0,
    totalErrors: [],
    excludedCount: 0,
    rejected: [],
  };

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const keywordRows = await prisma.exlusionKeywords.findMany();

  const cableRow = keywordRows.find((r) => r.category === "cable");
  const conductorsRow = keywordRows.find((r) => r.category === "conductors");

  function parseKeywordRow(row: typeof cableRow): string[] {
    if (!row || !row.keywords) return [];
    return [
      ...new Set(
        row.keywords
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
  }

  const cableKeywords = parseKeywordRow(cableRow);
  const conductorsKeywords = parseKeywordRow(conductorsRow);

  const dbMappingRows = await prisma.columnMapping.findMany({
    where: { status: "active" },
  });
  const mergedColumnMap = buildMergedColumnMap(dbMappingRows);

  const associations = await prisma.association.findMany();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const fileRecord = await prisma.file.create({
    data: {
      fileName: file.name,
      fileType:
        file.type ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileSize: file.size,
      status: "processing",
    },
  });
  fileResult.fileId = fileRecord.id;

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const limit = pLimit(SHEET_CONCURRENCY);

  const sheetTasks = workbook.SheetNames.map((sheetName) =>
    limit(async () => {
      const parsed = parseSheetData(
        workbook,
        sheetName,
        file.name,
        cableKeywords,
        conductorsKeywords,
        today,
        mergedColumnMap,
        associations,
      );

      const sheetResult: SheetResult = {
        sheetName: parsed.sheetName,
        count: 0,
        excludedCount: parsed.excludedCount,
        errors: [],
        skipped: parsed.skipped,
        rejected: parsed.rejected,
      };

      if (parsed.skipped) return sheetResult;

      await insertTenderMerged(parsed.prepared, fileRecord.id, sheetResult, file.name);

      return sheetResult;
    }),
  );

  const sheetResults = await Promise.all(sheetTasks);
  fileResult.sheets = sheetResults;

  for (const s of sheetResults) {
    fileResult.totalCount += s.count;
    fileResult.excludedCount += s.excludedCount;
    fileResult.totalErrors.push(...s.errors);
    fileResult.rejected.push(...s.rejected);
  }

  await prisma.file.update({
    where: { id: fileRecord.id },
    data: {
      status: fileResult.totalErrors.length
        ? "completed_with_errors"
        : "completed",
      totalCount: fileResult.totalCount,
      excludedCount: fileResult.excludedCount,
    },
  });

  return fileResult;
}
