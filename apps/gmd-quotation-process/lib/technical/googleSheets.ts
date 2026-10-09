import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import type { EngineeringTab } from "./types";

/**
 * Reads one tab of "GMD Technical Master Data" into positional rows.
 *
 * This is **sync-time only** — `lib/technical/syncEngineering.ts` is its sole
 * caller. The read path serves the UI from Postgres, so a browser request never
 * touches Google.
 *
 * Server-only: it holds the OAuth client, so it must not be imported from a
 * `"use client"` module.
 */

/** The workbook id. Configured per-environment so it need not be hard-coded. */
function getSpreadsheetId(): string {
  const id = process.env.TECHNICAL_SHEET_SPREADSHEET_ID;
  if (!id) {
    throw new Error("TECHNICAL_SHEET_SPREADSHEET_ID is not configured");
  }
  return id;
}

/**
 * Rows are padded/truncated to the tab's column count so a short row cannot
 * shift cells leftwards, and entirely-empty rows (the sheet has thousands of
 * trailing blank grid rows) are dropped.
 */
export async function fetchEngineeringSheet(
  tab: EngineeringTab,
): Promise<{ headers: string[]; rows: unknown[][] }> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });

  // `encodeURIComponent` is not used here: the googleapis client encodes the
  // range for us, and A1 notation needs the space and colon left intact.
  const range = `'${tab.sheetName}'!${tab.dataRange}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const columnCount = tab.columns.length;
  const rows: unknown[][] = [];

  for (const rawRow of res.data.values ?? []) {
    const row: unknown[] = new Array(columnCount).fill("");
    let hasValue = false;
    for (let i = 0; i < columnCount; i++) {
      const cell = rawRow[i];
      const value = cell == null ? "" : String(cell).trim();
      row[i] = value;
      if (value !== "") hasValue = true;
    }
    if (!hasValue) continue;
    rows.push(row);
  }

  return { headers: [...tab.columns], rows };
}
