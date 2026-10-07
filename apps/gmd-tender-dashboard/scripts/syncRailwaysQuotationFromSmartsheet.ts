import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { fetchSmartsheetById, type SmartsheetCell } from "../lib/smartsheet";

const SHEET_ID = "5621905471000452";
const ERP_TENDER_NO_COLUMN = "ERP Inquiry Voucher No. (Animesh)";
const QUOTATION_NO_COLUMN = "Quotation No. (Dipankar)";

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

async function main() {
  const sheet = await fetchSmartsheetById(SHEET_ID);

  const columnIndex = new Map<string, number>();
  for (const col of sheet.columns) {
    if (col.title) columnIndex.set(col.title.trim(), col.id);
  }

  const erpColId = resolveColumnId(columnIndex, sheet.columns, ERP_TENDER_NO_COLUMN);
  const quotationColId = resolveColumnId(columnIndex, sheet.columns, QUOTATION_NO_COLUMN);
  if (!erpColId || !quotationColId) {
    throw new Error(`Column not found: erp=${erpColId} quotation=${quotationColId}`);
  }

  const quotationLookup = new Map<string, string>();
  const lookupKeys: string[] = [];
  for (const row of sheet.rows) {
    const erpNo = getCellValue(row.cells, erpColId);
    if (!erpNo || erpNo === "-") continue;
    const quotationNo = getCellValue(row.cells, quotationColId);
    if (!quotationNo || quotationNo === "-" || ["n.a", "na", "not quoted"].includes(quotationNo.toLowerCase())) {
      continue;
    }
    const key = erpNo.toLowerCase();
    if (!quotationLookup.has(key)) {
      quotationLookup.set(key, quotationNo);
      lookupKeys.push(key);
    }
  }
  console.log(`Smartsheet lookup entries: ${quotationLookup.size}`);

  const findQuotation = (erpTenderNo: string): string | undefined => {
    const key = erpTenderNo.trim().toLowerCase();
    const exact = quotationLookup.get(key);
    if (exact !== undefined) return exact;
    const contains = lookupKeys.find((k) => k.includes(key));
    return contains !== undefined ? quotationLookup.get(contains) : undefined;
  };

  const candidates = await prisma.railways.findMany({
    where: {
      erpTenderNo: { not: null },
      qtnNo: null,
    },
    select: { id: true, erpTenderNo: true, qtnNo: true },
  });
  console.log(`Railways candidates (erpTenderNo set, qtnNo null): ${candidates.length}`);

  let updated = 0;
  let noMatch = 0;
  const samples: string[] = [];
  for (const row of candidates) {
    const quotationNo = findQuotation(row.erpTenderNo!);
    if (quotationNo === undefined) {
      noMatch++;
      continue;
    }
    if (samples.length < 5) {
      samples.push(`${row.erpTenderNo} -> ${quotationNo}`);
    }
    await prisma.railways.update({
      where: { id: row.id },
      data: { qtnNo: quotationNo },
    });
    updated++;
  }

  samples.forEach((s) => console.log(`  sample: ${s}`));
  console.log(`Updated: ${updated}, noMatch: ${noMatch}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});