import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../googleAuth";
import {
  PHYSICAL_COLUMNS,
  PHYSICAL_COL_INDEX_TO_DB_FIELD,
} from "./physical-stock-columns";

const STOCK_PHYS_TAB_GID = 1240474226;
const STOCK_PHYS_TAB_TITLE = "stock-phys";

function getSpreadsheetId(): string {
  const id =
    process.env.STOCK_PHYSICAL_SHEET_ID ?? process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) {
    throw new Error(
      "STOCK_PHYSICAL_SHEET_ID / GOOGLE_SPREADSHEET_ID is not configured",
    );
  }
  return id;
}

function getSheetsClient() {
  return googleSheets({ version: "v4", auth: getOAuthClient() });
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function buildColumnIndexMap(
  sheetHeaders: string[],
): (number | undefined)[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const used = new Set<number>();
  return PHYSICAL_COLUMNS.map((col) => {
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

/**
 * Finds the stock-phys tab: prefer the tab whose gid matches the known
 * stock-physical tab, fall back to a tab literally titled "stock-phys".
 */
async function resolveStockPhysTab(spreadsheetId: string): Promise<string> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabs = meta.data.sheets ?? [];
  const byGid = tabs.find((s) => s.properties?.sheetId === STOCK_PHYS_TAB_GID);
  if (byGid?.properties?.title) return byGid.properties.title;
  const byTitle = tabs.find(
    (s) => s.properties?.title === STOCK_PHYS_TAB_TITLE,
  );
  if (byTitle?.properties?.title) return byTitle.properties.title;
  throw new Error(
    `Sheet tab for stock physical data not found (gid=${STOCK_PHYS_TAB_GID} or title="${STOCK_PHYS_TAB_TITLE}")`,
  );
}

/**
 * Fetches the stock-physical sheet tab. Headers are in row 2 (B2 onwards),
 * data rows start at row 3. Column A is a helper column and is skipped.
 * Returns rows keyed by the snake_case PhysicalStock DB fields defined in
 * PHYSICAL_COL_INDEX_TO_DB_FIELD (via PHYSICAL_COLUMNS order).
 */
export async function fetchPhysicalStockSheet(): Promise<
  Record<string, string | null>[]
> {
  const spreadsheetId = getSpreadsheetId();
  const tab = await resolveStockPhysTab(spreadsheetId);
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 3) return [];

  const sheetHeaders = (allRows[1] ?? []).map(String);
  const colIdxByField = buildColumnIndexMap(sheetHeaders);
  const dataRows = allRows.slice(2);
  const result: Record<string, string | null>[] = [];

  for (const row of dataRows) {
    const record: Record<string, string | null> = {};
    for (let i = 0; i < PHYSICAL_COLUMNS.length; i++) {
      const field = PHYSICAL_COL_INDEX_TO_DB_FIELD[i];
      const idx = colIdxByField[i];
      if (!field || idx === undefined) continue;
      const raw = row[idx];
      const value =
        raw === undefined || raw === null || String(raw).trim() === ""
          ? null
          : String(raw).trim();
      record[field] = value;
    }
    result.push(record);
  }

  return result;
}
