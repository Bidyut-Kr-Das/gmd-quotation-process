/**
 * services/tender.service.ts
 *
 * Tender service for Smartsheet data.
 * Connects to Smartsheet, reads the configured sheet, and maps data by COLUMN NAME (never by index).
 * Returns clean typed SmartsheetTender records. If a column is missing, returns null for that field.
 */

import { fetchSmartsheet, SmartsheetSheetData, SmartsheetColumn, SmartsheetCell } from "@/lib/smartsheet";
import { SmartsheetTender } from "@/types/smartsheetTender";

/** Map of SmartsheetTender field names to the actual Smartsheet column titles */
const COLUMN_MAP: Record<"enquiryDate" | "partyName" | "docketNumber" | "utility" | "quotationNumber" | "quotationDate" | "accountHolder" | "tenderPurchase", string> = {
  enquiryDate:     "Enquiry Date(MM-DD-YY)  (Debosmita Nath)",
  partyName:       "Party Name  (Debosmita Nath)",
  docketNumber:    "Docket No  (Debosmita Nath)",
  utility:         "Utility (Marketing Team)",
  quotationNumber: "Quotation No. (Dipankar)",
  quotationDate:   "Quotation DateFORMAT(MM-DD-YY)(Dipankar)",
  accountHolder:   "Account Holder",
  tenderPurchase:  "Tender/ Purchase/Bugetary/ Laser Tender (Marketing",
};

/**
 * Builds a column title → columnId lookup map from the sheet columns array.
 */
function buildColumnIndex(columns: SmartsheetColumn[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const col of columns) {
    if (col.title) {
      index.set(col.title.trim(), col.id);
    }
  }
  return index;
}

/**
 * Extracts a cell's display value safely, returning null if missing.
 */
function getCellValue(cells: SmartsheetCell[], columnId: number | undefined): string | null {
  if (columnId === undefined) return null;
  const cell = cells.find((c) => c.columnId === columnId);
  if (!cell) return null;
  // Prefer displayValue, then cast value to string
  if (cell.displayValue !== undefined && cell.displayValue !== null) {
    return String(cell.displayValue).trim() || null;
  }
  if (cell.value !== undefined && cell.value !== null) {
    return String(cell.value).trim() || null;
  }
  return null;
}

/**
 * Maps a single sheet row to a SmartsheetTender record.
 * Uses column title index (not positional index).
 */
function mapRow(
  cells: SmartsheetCell[],
  columnIndex: Map<string, number>
): SmartsheetTender {
  const getField = (field: keyof typeof COLUMN_MAP): string | null => {
    const title = COLUMN_MAP[field];
    const colId = columnIndex.get(title);
    return getCellValue(cells, colId);
  };

  return {
    enquiryDate:     getField("enquiryDate"),
    partyName:       getField("partyName"),
    docketNumber:    getField("docketNumber"),
    utility:         getField("utility"),
    quotationNumber: getField("quotationNumber"),
    quotationDate:   getField("quotationDate"),
    accountHolder:   getField("accountHolder"),
    tenderPurchase:  getField("tenderPurchase"),
  };
}

/**
 * Fetches and maps Smartsheet tender records.
 * Makes exactly one Smartsheet API call per invocation.
 * Returns an array of SmartsheetTender records with null-safe field values.
 */
export async function fetchSmartsheetTenders(): Promise<SmartsheetTender[]> {
  const sheetData: SmartsheetSheetData = await fetchSmartsheet();

  const columnIndex = buildColumnIndex(sheetData.columns || []);

  const rows = sheetData.rows || [];
  return rows.map((row) => mapRow(row.cells || [], columnIndex));
}
