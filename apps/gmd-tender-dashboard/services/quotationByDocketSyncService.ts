import { prisma } from "@/lib/prisma";
import { fetchSmartsheet, SmartsheetCell } from "@/lib/smartsheet";

const DOCKET_NO_COLUMN = "Docket No  (Debosmita Nath)";
const QUOTATION_NO_COLUMN = "Quotation No. (Dipankar)";

const NULL_QUOTATION_VALUES = new Set(["", "-", "not quoted", "n.a", "na", "null"]);

export interface QuotationByDocketSyncStats {
  total: number;
  found: number;
  updated: number;
  notFound: number;
  skippedExisting: number;
  skippedNullQuotationSheet: number;
  skippedNullDocketDb: number;
  skippedNullDocketSheet: number;
  duplicateDockets: number;
  errors: number;
  columnCheck: {
    docketColumnFound: boolean;
    quotationColumnFound: boolean;
    docketColumnId?: number;
    quotationColumnId?: number;
    allColumnTitles: string[];
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
  // Exact match first (as stored trimmed)
  const exact = columnIndex.get(targetTitle);
  if (exact !== undefined) return exact;
  // Trimmed exact
  const trimmed = columnIndex.get(targetTitle.trim());
  if (trimmed !== undefined) return trimmed;
  // Normalized fallback — handles double-space vs single-space drift
  const normTarget = normalizeTitle(targetTitle);
  for (const col of allColumns) {
    if (normalizeTitle(col.title) === normTarget) {
      return col.id;
    }
  }
  return undefined;
}

export interface SyncOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

export async function syncQuotationByDocketFromSmartsheet(
  options: SyncOptions = {},
): Promise<QuotationByDocketSyncStats> {
  const stats: QuotationByDocketSyncStats = {
    total: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    skippedExisting: 0,
    skippedNullQuotationSheet: 0,
    skippedNullDocketDb: 0,
    skippedNullDocketSheet: 0,
    duplicateDockets: 0,
    errors: 0,
    columnCheck: {
      docketColumnFound: false,
      quotationColumnFound: false,
      allColumnTitles: [],
    },
  };

  let sheetData;
  try {
    sheetData = await fetchSmartsheet();
  } catch (err) {
    console.warn("[QuotationByDocketSync] Failed to fetch Smartsheet:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  const columns = sheetData.columns || [];
  const rows = sheetData.rows || [];

  stats.columnCheck.allColumnTitles = columns.map((c) => c.title);

  // Build columnIndex with trimmed titles for exact lookups
  const columnIndex = new Map<string, number>();
  for (const col of columns) {
    if (col.title) {
      columnIndex.set(col.title.trim(), col.id);
      // Also keep original as fallback
      if (col.title !== col.title.trim()) {
        columnIndex.set(col.title, col.id);
      }
    }
  }

  // === Column name verification before proceeding ===
  const docketNoColId = resolveColumnId(columnIndex, columns, DOCKET_NO_COLUMN);
  const quotationNoColId = resolveColumnId(columnIndex, columns, QUOTATION_NO_COLUMN);

  stats.columnCheck.docketColumnFound = docketNoColId !== undefined;
  stats.columnCheck.quotationColumnFound = quotationNoColId !== undefined;
  stats.columnCheck.docketColumnId = docketNoColId;
  stats.columnCheck.quotationColumnId = quotationNoColId;

  if (!docketNoColId) {
    console.warn(`[QuotationByDocketSync] Column check failed — "${DOCKET_NO_COLUMN}" NOT FOUND. Aborting.`);
    console.warn(`[QuotationByDocketSync] Available columns: ${stats.columnCheck.allColumnTitles.map((t) => `"${t}"`).join(", ")}`);
    stats.errors++;
    return stats;
  }
  if (!quotationNoColId) {
    console.warn(`[QuotationByDocketSync] Column check failed — "${QUOTATION_NO_COLUMN}" NOT FOUND. Aborting.`);
    console.warn(`[QuotationByDocketSync] Available columns: ${stats.columnCheck.allColumnTitles.map((t) => `"${t}"`).join(", ")}`);
    stats.errors++;
    return stats;
  }

  if (options.verbose) {
    console.log(`[QuotationByDocketSync] Column check passed:`);
    console.log(`  "${DOCKET_NO_COLUMN}" -> id ${docketNoColId}`);
    console.log(`  "${QUOTATION_NO_COLUMN}" -> id ${quotationNoColId}`);
    console.log(`  Sheet rows: ${rows.length}`);
  }

  // Build lookup: docket(lower, trimmed) -> quotation (non-empty, non-null only)
  const quotationLookup = new Map<string, string>();
  for (const row of rows) {
    const cells = row.cells || [];
    const docketNo = getCellValue(cells, docketNoColId);
    if (!docketNo || docketNo.trim() === "" || docketNo.trim() === "-") {
      stats.skippedNullDocketSheet++;
      continue;
    }
    const quotationNo = getCellValue(cells, quotationNoColId);
    // Requirement: if quotation number is null/empty -> no changes
    if (!quotationNo || quotationNo.trim() === "") {
      stats.skippedNullQuotationSheet++;
      continue;
    }
    const qTrim = quotationNo.trim();
    if (NULL_QUOTATION_VALUES.has(qTrim.toLowerCase())) {
      stats.skippedNullQuotationSheet++;
      continue;
    }

    const key = docketNo.trim().toLowerCase();
    if (quotationLookup.has(key)) {
      stats.duplicateDockets++;
      if (options.verbose) {
        console.warn(`[QuotationByDocketSync] Duplicate docket in sheet: "${docketNo}" keeps first value "${quotationLookup.get(key)}", ignoring "${qTrim}" row ${row.rowNumber}`);
      }
      continue;
    }
    quotationLookup.set(key, qTrim);
  }

  if (options.verbose) {
    console.log(`[QuotationByDocketSync] Lookup built: ${quotationLookup.size} docket->quotation mappings (${stats.skippedNullQuotationSheet} skipped null/empty quotations, ${stats.skippedNullDocketSheet} skipped null dockets, ${stats.duplicateDockets} duplicates)`);
  }

  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, docketNo: true, quotationNo: true },
  });

  stats.total = allTenders.length;

  for (const tender of allTenders) {
    // Requirement: if docket number is null -> no changes
    if (!tender.docketNo || tender.docketNo.trim() === "" || tender.docketNo.trim() === "-") {
      stats.skippedNullDocketDb++;
      continue;
    }

    // Requirement: quotation number already present in DB should not be touched
    if (tender.quotationNo !== null && tender.quotationNo !== undefined && tender.quotationNo.trim() !== "") {
      stats.skippedExisting++;
      continue;
    }

    const docketLower = tender.docketNo.trim().toLowerCase();
    const quotationNo = quotationLookup.get(docketLower);

    if (quotationNo === undefined) {
      stats.notFound++;
      continue;
    }

    // At this point quotationNo is guaranteed non-null/non-empty per lookup construction
    stats.found++;

    if (options.dryRun) {
      if (options.verbose) {
        console.log(`[DRY-RUN] Would update id=${tender.id} docket="${tender.docketNo}" quotation: null -> "${quotationNo}"`);
      }
      stats.updated++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { quotationNo },
      });
      stats.updated++;
      if (options.verbose) {
        console.log(`[QuotationByDocketSync] Updated id=${tender.id} docket="${tender.docketNo}" -> quotationNo="${quotationNo}"`);
      }
    } catch (err) {
      console.warn(`[QuotationByDocketSync] Failed to update quotationNo for docket ${tender.docketNo}:`, (err as Error).message);
      stats.errors++;
    }
  }

  return stats;
}
