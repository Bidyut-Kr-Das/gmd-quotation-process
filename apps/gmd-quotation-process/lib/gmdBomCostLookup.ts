import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";

const SHEET_SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502; // GMD Item Creation Form

export const DIRECT_M2M = "DIRECT M2M";

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mon = months[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const day = parseInt(m[1], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (isNaN(day) || day < 1 || day > 31 || isNaN(year)) return null;
  return new Date(year, mon, day);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

export interface BomSheetRow {
  itemCode: string;
  bomId: string | null;
  rmItemCode: string;
}

// Cache for DIRECT_M2M itemCode set to avoid repeated sheet fetches per request
let cachedBomRows: BomSheetRow[] | null = null;
let cachedBomRowsAt = 0;
const BOM_CACHE_TTL_MS = 60_000; // 1 minute

export function clearBomCache() {
  cachedBomRows = null;
  cachedBomRowsAt = 0;
}

export async function getCachedBomRows(): Promise<BomSheetRow[]> {
  const now = Date.now();
  if (cachedBomRows && now - cachedBomRowsAt < BOM_CACHE_TTL_MS) {
    return cachedBomRows;
  }
  const rows = await fetchBomRows();
  cachedBomRows = rows;
  cachedBomRowsAt = now;
  return rows;
}

export async function getDirectM2MSet(): Promise<Set<string>> {
  const rows = await getCachedBomRows();
  return new Set(rows.map((r) => r.itemCode));
}

export async function hasDirectM2M(itemCode: string): Promise<boolean> {
  const set = await getDirectM2MSet();
  return set.has(itemCode);
}

export async function getBomEntry(itemCode: string): Promise<BomSheetRow | null> {
  const rows = await getCachedBomRows();
  return rows.find((r) => r.itemCode === itemCode) ?? null;
}

/**
 * Fetches the "GMD Item Creation Form" tab and returns the DIRECT M2M rows
 * that have a CONSUMPTION-1 (rm) code, keyed by "Code for The Item".
 */
export async function fetchBomRows(): Promise<BomSheetRow[]> {
  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Sheet with gid ${SHEET_GID} not found in spreadsheet`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    return [];
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const colFirst = (name: string) => normalized.indexOf(name);
  const colLast = (name: string) => normalized.lastIndexOf(name);

  const codeIdx = colFirst("CODE FOR THE ITEM");
  const itemTypeIdx = colLast("ITEM TYPE");
  const bomIdIdx = colFirst("BOM ID");
  const rmIdx = colFirst("CONSUMPTION-1");

  if (codeIdx === -1 || itemTypeIdx === -1 || bomIdIdx === -1 || rmIdx === -1) {
    throw new Error(
      `Required columns not found. Found indices: ${JSON.stringify({
        codeIdx, itemTypeIdx, bomIdIdx, rmIdx,
        headers: headers.map((h, i) => (h.trim() ? `${i}:${h}` : null)).filter(Boolean),
      })}`,
    );
  }

  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const seen = new Set<string>();
  const result: BomSheetRow[] = [];

  for (const row of dataRows) {
    if (String(row[itemTypeIdx] ?? "").trim().toUpperCase() !== DIRECT_M2M) continue;
    const itemCode = String(row[codeIdx] ?? "").trim();
    const rmItemCode = String(row[rmIdx] ?? "").trim();
    if (!itemCode || !rmItemCode) continue;
    if (seen.has(itemCode)) continue;
    seen.add(itemCode);

    const bomIdRaw = String(row[bomIdIdx] ?? "").trim();
    result.push({
      itemCode,
      bomId: bomIdRaw ? bomIdRaw : null,
      rmItemCode,
    });
  }

  return result;
}

/**
 * Builds a map of rm item code -> latest-by-date unit cost (value / quantity)
 * from the SupplyHistoryItem (raw material) table.
 */
export async function buildRmCostMap(
  rmCodes: string[],
): Promise<Map<string, number>> {
  const costMap = new Map<string, number>();

  if (rmCodes.length === 0) return costMap;

  const rows = await prisma.supplyHistoryItem.findMany({
    where: { erpItemCode: { in: rmCodes } },
    select: {
      erpItemCode: true,
      quantity: true,
      value: true,
      date: true,
    },
  });

  const byCode = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.erpItemCode) continue;
    const list = byCode.get(row.erpItemCode) ?? [];
    list.push(row);
    byCode.set(row.erpItemCode, list);
  }

  for (const [code, list] of byCode) {
    let best: { date: Date | null; unitCost: number } | null = null;
    for (const row of list) {
      const qty = toNumber(row.quantity);
      const value = toNumber(row.value);
      if (qty === null || value === null || qty <= 0) continue;
      const unitCost = value / qty;
      const date = parseDate(row.date);
      if (
        best === null ||
        (date !== null && (best.date === null || date > best.date)) ||
        (date !== null && best.date !== null && date.getTime() === best.date.getTime() && unitCost > best.unitCost)
      ) {
        best = { date, unitCost };
      }
    }
    if (best !== null) {
      costMap.set(code, best.unitCost);
    }
  }

  return costMap;
}
