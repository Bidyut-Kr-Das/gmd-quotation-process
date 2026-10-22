import { prisma } from "@/lib/prisma";
import { fetchSmartsheetById, type SmartsheetCell } from "@/lib/smartsheet";

const SHEET_ID = "5621905471000452";
const DOCKET_NO_COLUMN = "Docket No (Debosmita Nath)";
const QUOTATION_NO_COLUMN = "Quotation No. (Dipankar)";

export interface QuotationSyncStats {
  total: number;
  found: number;
  updated: number;
  notFound: number;
  skippedNullQuotation: number;
  errors: number;
  columnCheck: {
    docketColumnFound: boolean;
    quotationColumnFound: boolean;
    docketColumnId?: number;
    quotationColumnId?: number;
  };
}

function getCellValue(cells: SmartsheetCell[], columnId: number | undefined): string | null {
  if (columnId === undefined) return null;
  const cell = cells.find((c) => c.columnId === columnId);
  if (!cell) return null;
  if (cell.displayValue !== undefined && cell.displayValue !== null) {
    return String(cell.displayValue).trim() || null;
  }
  if (cell.value !== undefined && cell.value !== null) {
    return String(cell.value).trim() || null;
  }
  return null;
}

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveColumnId(
  columnIndex: Map<string, number>,
  allColumns: { id: number; title: string }[],
  targetTitle: string,
): number | undefined {
  const exact = columnIndex.get(targetTitle);
  if (exact !== undefined) return exact;
  const trimmed = columnIndex.get(targetTitle.trim());
  if (trimmed !== undefined) return trimmed;
  const normTarget = normalizeTitle(targetTitle);
  for (const col of allColumns) {
    if (normalizeTitle(col.title) === normTarget) return col.id;
  }
  return undefined;
}

export async function syncQuotationFromSmartsheet(): Promise<QuotationSyncStats> {
  const stats: QuotationSyncStats = {
    total: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    skippedNullQuotation: 0,
    errors: 0,
    columnCheck: { docketColumnFound: false, quotationColumnFound: false },
  };

  let sheetData;
  try {
    sheetData = await fetchSmartsheetById(SHEET_ID);
  } catch (err) {
    console.warn("[QuotationSync] Failed to fetch Smartsheet:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  const columns = sheetData.columns || [];
  const rows = sheetData.rows || [];

  const columnIndex = new Map<string, number>();
  for (const col of columns) {
    if (col.title) {
      columnIndex.set(col.title.trim(), col.id);
      if (col.title !== col.title.trim()) columnIndex.set(col.title, col.id);
    }
  }

  const docketNoColId = resolveColumnId(columnIndex, columns, DOCKET_NO_COLUMN);
  const quotationNoColId = resolveColumnId(columnIndex, columns, QUOTATION_NO_COLUMN);

  stats.columnCheck.docketColumnFound = docketNoColId !== undefined;
  stats.columnCheck.quotationColumnFound = quotationNoColId !== undefined;
  stats.columnCheck.docketColumnId = docketNoColId;
  stats.columnCheck.quotationColumnId = quotationNoColId;

  if (!docketNoColId) {
    console.warn(`[QuotationSync] Column "${DOCKET_NO_COLUMN}" NOT FOUND. Aborting.`);
    stats.errors++;
    return stats;
  }
  if (!quotationNoColId) {
    console.warn(`[QuotationSync] Column "${QUOTATION_NO_COLUMN}" NOT FOUND. Aborting.`);
    stats.errors++;
    return stats;
  }

  // Build lookup docketLower -> quotation (skip empty quotations)
  const quotationLookup = new Map<string, string>();
  for (const row of rows) {
    const cells = row.cells || [];
    const docketNo = getCellValue(cells, docketNoColId);
    if (!docketNo || docketNo.trim() === "" || docketNo.trim() === "-") continue;
    const quotationNo = getCellValue(cells, quotationNoColId);
    if (!quotationNo || quotationNo.trim() === "" || quotationNo.trim() === "-" || ["n.a", "na", "not quoted"].includes(quotationNo.trim().toLowerCase())) {
      stats.skippedNullQuotation++;
      continue;
    }
    const key = docketNo.trim().toLowerCase();
    if (!quotationLookup.has(key)) {
      quotationLookup.set(key, quotationNo.trim());
    }
  }

  // Independent query: docketNo not null AND quotationNo is null/empty — if one fails, others unaffected
  let candidates: Array<{ id: number; docketNo: string | null; quotationNo: string | null }>;
  try {
    candidates = await prisma.tenderMerged.findMany({
      where: {
        docketNo: { not: null },
        NOT: { docketNo: "" },
        OR: [{ quotationNo: null }, { quotationNo: "" }],
      },
      select: { id: true, docketNo: true, quotationNo: true },
    });
  } catch (err) {
    console.warn("[QuotationSync] DB query failed:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  stats.total = candidates.length;

  for (const tender of candidates) {
    try {
      const docketLower = tender.docketNo!.trim().toLowerCase();
      const quotationNo = quotationLookup.get(docketLower);
      if (quotationNo === undefined) {
        stats.notFound++;
        continue;
      }
      stats.found++;
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { quotationNo },
      });
      stats.updated++;
    } catch (err) {
      console.warn(`[QuotationSync] Failed docket ${tender.docketNo}:`, (err as Error).message);
      stats.errors++;
    }
  }

  return stats;
}
