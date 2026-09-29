import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../googleAuth";

export const BOM_MAST_ERP_SPREADSHEET_ID =
  "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";

/** gid 1180547059 -> "BOM MAST ERP". BOM_ID, ITEM_CODE, RM_ITEM_CODE, TO_DATE. */
export const BOM_MAST_ERP_GID = 1180547059;
/** gid 253020709 -> "ITEM MASTER ERP". ITEM_CODE -> ITEM_NAME. */
export const ITEM_MASTER_ERP_GID = 253020709;

export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/_+/g, " ")
    .trim();
}

function getClient() {
  return googleSheets({ version: "v4", auth: getOAuthClient() });
}

/**
 * Resolves a tab by its gid (never by title) so renaming a tab cannot
 * silently redirect the read to the wrong columns.
 */
export async function readSheetTabByGid(
  spreadsheetId: string,
  gid: number,
): Promise<{ tabTitle: string; headers: string[]; rows: string[][] }> {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === gid,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    const available = (meta.data.sheets ?? [])
      .map((s) => `${s.properties?.sheetId}: ${s.properties?.title}`)
      .join(", ");
    throw new Error(
      `No tab with gid ${gid} in spreadsheet ${spreadsheetId}. Available: ${available}`,
    );
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A1:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = res.data.values ?? [];
  const headers = (values[0] ?? []).map(String);
  const rows = values.slice(1).map((r) => r.map(String));
  return { tabTitle, headers, rows };
}

/**
 * Exact-match column resolver. Deliberately NOT fuzzy: a loose matcher such
 * as /TO.*DATE/ can silently bind to BOM DATE instead of TO DATE.
 */
export function findColumn(
  headers: string[],
  header: string,
): number {
  const target = normalizeHeader(header);
  return headers.map(normalizeHeader).findIndex((h) => h === target);
}

export function requireColumns(
  headers: string[],
  required: string[],
  tabTitle: string,
): number[] {
  const idx = required.map((h) => findColumn(headers, h));
  const missing = required.filter((_, i) => idx[i] === -1);
  if (missing.length > 0) {
    throw new Error(
      `Sheet "${tabTitle}" is missing required column(s): ${missing.join(", ")}`,
    );
  }
  return idx;
}

export function cell(row: string[], idx: number): string {
  if (idx < 0) return "";
  return String(row[idx] ?? "").trim();
}

export type BomMastRow = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  toDate: string;
};

export function readBomMastErp(): Promise<{
  tabTitle: string;
  rows: BomMastRow[];
  skipped: number;
}> {
  return readSheetTabByGid(BOM_MAST_ERP_SPREADSHEET_ID, BOM_MAST_ERP_GID).then(
    ({ tabTitle, headers, rows }) => {
      const [bomIdx, itemIdx, rmIdx, toDateIdx] = requireColumns(
        headers,
        ["BOM_ID", "ITEM_CODE", "RM_ITEM_CODE", "TO_DATE"],
        tabTitle,
      );
      const out: BomMastRow[] = [];
      let skipped = 0;
      for (const row of rows) {
        const bomId = cell(row, bomIdx);
        const itemCode = cell(row, itemIdx);
        const rmItemCode = cell(row, rmIdx);
        if (!bomId || !itemCode || !rmItemCode) {
          skipped++;
          continue;
        }
        out.push({
          bomId,
          itemCode,
          rmItemCode,
          toDate: cell(row, toDateIdx),
        });
      }
      return { tabTitle, rows: out, skipped };
    },
  );
}

export type ItemMasterEntry = {
  itemCode: string;
  itemName: string;
};

export function readItemMasterErp(): Promise<{
  tabTitle: string;
  /** keyed by trim().toUpperCase() ITEM_CODE -> ITEM_NAME */
  nameByCode: Map<string, string>;
  duplicateCodes: number;
}> {
  return readSheetTabByGid(BOM_MAST_ERP_SPREADSHEET_ID, ITEM_MASTER_ERP_GID).then(
    ({ tabTitle, headers, rows }) => {
      const [codeIdx, nameIdx] = requireColumns(
        headers,
        ["ITEM_CODE", "ITEM_NAME"],
        tabTitle,
      );
      const nameByCode = new Map<string, string>();
      let duplicateCodes = 0;
      for (const row of rows) {
        const itemCode = cell(row, codeIdx).toUpperCase();
        const itemName = cell(row, nameIdx);
        if (!itemCode || !itemName) continue;
        if (nameByCode.has(itemCode)) {
          duplicateCodes++;
          continue; // first row wins, deterministically
        }
        nameByCode.set(itemCode, itemName);
      }
      return { tabTitle, nameByCode, duplicateCodes };
    },
  );
}
