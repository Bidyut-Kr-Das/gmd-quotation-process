import "server-only";
import { sheets as googleSheets, type sheets_v4 } from "@googleapis/sheets";
import { COLUMNS, FIELDS } from "../columns";

export type SheetsAuth = sheets_v4.Options["auth"];

const STOCK_PHYS_TAB_GID = 1240474226;
const STOCK_PHYS_TAB_TITLE = "stock-phys";

function getSpreadsheetId(): string {
  const id = process.env.STOCK_PHYSICAL_SHEET_ID ?? process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("STOCK_PHYSICAL_SHEET_ID / GOOGLE_SPREADSHEET_ID is not configured");
  return id;
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function buildColumnIndexMap(sheetHeaders: string[]): (number | undefined)[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const used = new Set<number>();
  return COLUMNS.map((col) => {
    const key = normalizeHeader(col);
    for (let i = 0; i < normalized.length; i++) {
      if (!used.has(i) && normalized[i] === key) {
        used.add(i);
        return i;
      }
    }
    return undefined;
  });
}

/** The tab with the known gid, else one titled "stock-phys". */
async function resolveStockPhysTab(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabs = meta.data.sheets ?? [];
  const byGid = tabs.find((s) => s.properties?.sheetId === STOCK_PHYS_TAB_GID);
  if (byGid?.properties?.title) return byGid.properties.title;
  const byTitle = tabs.find((s) => s.properties?.title === STOCK_PHYS_TAB_TITLE);
  if (byTitle?.properties?.title) return byTitle.properties.title;
  throw new Error(
    `Sheet tab for stock physical data not found (gid=${STOCK_PHYS_TAB_GID} or title="${STOCK_PHYS_TAB_TITLE}")`,
  );
}

/**
 * Fetches the stock-physical sheet tab. Headers are in row 2 (B2 onwards),
 * data rows start at row 3. Column A is a helper column and is skipped.
 * Returns rows keyed by the PhysicalStock DB fields (COLUMNS/FIELDS order).
 */
export async function fetchPhysicalStockSheet(auth: SheetsAuth): Promise<Record<string, string | null>[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = googleSheets({ version: "v4", auth });
  const tab = await resolveStockPhysTab(sheets, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 3) return [];

  const colIdxByField = buildColumnIndexMap((allRows[1] ?? []).map(String));
  return allRows.slice(2).map((row) => {
    const record: Record<string, string | null> = {};
    for (let i = 0; i < FIELDS.length; i++) {
      const idx = colIdxByField[i];
      if (idx === undefined) continue;
      const raw = row[idx];
      record[FIELDS[i]] =
        raw === undefined || raw === null || String(raw).trim() === "" ? null : String(raw).trim();
    }
    return record;
  });
}
