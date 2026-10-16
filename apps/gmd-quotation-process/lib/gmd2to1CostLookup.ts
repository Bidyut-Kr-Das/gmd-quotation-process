import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import { recalculateItem, serializeItem } from "@/lib/costCalculator";

const SHEET_SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502; // GMD Item Creation Form

export const BOM_TYPE_2TO1 = "2:1";

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function parseNumericCost(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export interface Bom2to1SheetRow {
  itemCode: string;
  bomId: string | null;
  consumptionCodes: string[];
}

let cached2to1Rows: Bom2to1SheetRow[] | null = null;
let cached2to1RowsAt = 0;
const BOM_CACHE_TTL_MS = 60_000; // 1 minute

export function clear2to1BomCache() {
  cached2to1Rows = null;
  cached2to1RowsAt = 0;
}

export async function getCached2to1BomRows(): Promise<Bom2to1SheetRow[]> {
  const now = Date.now();
  if (cached2to1Rows && now - cached2to1RowsAt < BOM_CACHE_TTL_MS) {
    return cached2to1Rows;
  }
  const rows = await fetch2to1BomRows();
  cached2to1Rows = rows;
  cached2to1RowsAt = now;
  return rows;
}

/**
 * Fetches the "GMD Item Creation Form" tab and returns rows with ITEM TYPE = "2:1"
 * and non-empty BOM ID. Extracts CONSUMPTION-1, CONSUMPTION-2, etc. (excluding codes starting with 'F').
 */
export async function fetch2to1BomRows(): Promise<Bom2to1SheetRow[]> {
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

  const codeIdx = normalized.indexOf("CODE FOR THE ITEM");
  const itemTypeIdx = normalized.lastIndexOf("ITEM TYPE");
  const bomIdIdx = normalized.indexOf("BOM ID");

  if (codeIdx === -1 || itemTypeIdx === -1 || bomIdIdx === -1) {
    throw new Error(
      `Required columns not found in sheet. Indices: ${JSON.stringify({
        codeIdx, itemTypeIdx, bomIdIdx,
      })}`,
    );
  }

  // Find all CONSUMPTION column indices (CONSUMPTION-1, CONSUMPTION-2, etc.)
  const consumptionIndices: number[] = [];
  normalized.forEach((h, idx) => {
    if (h.startsWith("CONSUMPTION")) {
      consumptionIndices.push(idx);
    }
  });

  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const seen = new Set<string>();
  const result: Bom2to1SheetRow[] = [];

  for (const row of dataRows) {
    const itemTypeRaw = String(row[itemTypeIdx] ?? "").trim().toUpperCase();
    if (itemTypeRaw !== BOM_TYPE_2TO1) continue;

    const bomIdRaw = String(row[bomIdIdx] ?? "").trim();
    if (!bomIdRaw || bomIdRaw === "-") continue;

    const itemCode = String(row[codeIdx] ?? "").trim();
    if (!itemCode || seen.has(itemCode)) continue;
    seen.add(itemCode);

    const consumptionCodes: string[] = [];
    for (const cIdx of consumptionIndices) {
      const codeVal = String(row[cIdx] ?? "").trim();
      if (!codeVal || codeVal === "-") continue;
      // Exclude codes starting with 'F' or 'f'
      if (codeVal.toUpperCase().startsWith("F")) continue;
      consumptionCodes.push(codeVal);
    }

    result.push({
      itemCode,
      bomId: bomIdRaw,
      consumptionCodes,
    });
  }

  return result;
}

/**
 * Builds a map of raw material erpItemCode -> numeric cost from the Raw Materials table (GMDUpdateItem).
 */
export async function buildRawMaterialsCostMap(
  rmCodes: string[],
): Promise<Map<string, number>> {
  const costMap = new Map<string, number>();
  if (rmCodes.length === 0) return costMap;

  const rawMaterials = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: rmCodes } },
    select: {
      erpItemCode: true,
      cost: true,
    },
  });

  for (const rm of rawMaterials) {
    if (!rm.erpItemCode) continue;
    const numericCost = parseNumericCost(rm.cost);
    if (numericCost !== null && numericCost > 0) {
      // If duplicate erpItemCode in GMDUpdateItem, keep first valid non-zero cost
      if (!costMap.has(rm.erpItemCode)) {
        costMap.set(rm.erpItemCode, numericCost);
      }
    }
  }

  return costMap;
}

/**
 * Updates the 'cost' column in Quotation Process table for specified items having 2:1 BOM type
 * whose cost is currently null, 0, or "-".
 */
export async function update2to1CostForItems(itemIds: string[]) {
  const bomRows = await getCached2to1BomRows();
  const bomMap = new Map<string, Bom2to1SheetRow>();
  for (const r of bomRows) {
    bomMap.set(r.itemCode, r);
  }

  // Collect all consumption codes across matched 2:1 items
  const allRmCodesSet = new Set<string>();
  for (const r of bomRows) {
    for (const c of r.consumptionCodes) {
      allRmCodesSet.add(c);
    }
  }

  const rmCostMap = await buildRawMaterialsCostMap([...allRmCodesSet]);

  const items = await prisma.enquiryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, erpItemCode: true, cost: true },
  });

  const updatedItems: ReturnType<typeof serializeItem>[] = [];
  let updatedCount = 0;
  const noCostItemCodes = new Set<string>();
  const noBomItemCodes = new Set<string>();

  for (const item of items) {
    // Only update if cost is null, 0, or unpopulated (not overriding existing non-null cost)
    const existingCostNum = item.cost ? Number(item.cost) : null;
    if (existingCostNum !== null && existingCostNum > 0) {
      continue;
    }

    if (!item.erpItemCode) continue;

    const bomEntry = bomMap.get(item.erpItemCode);
    if (!bomEntry) {
      noBomItemCodes.add(item.erpItemCode);
      continue;
    }

    // Sum costs of valid consumption item codes from Raw Materials cost map
    let sumCost = 0;
    let validConsumptionCount = 0;
    for (const cCode of bomEntry.consumptionCodes) {
      const cCost = rmCostMap.get(cCode);
      if (cCost !== undefined && cCost !== null) {
        sumCost += cCost;
        validConsumptionCount++;
      }
    }

    if (validConsumptionCount > 0 && sumCost > 0) {
      // Recalculate item passing 'cost' explicitly
      const recalculated = await recalculateItem(item.id, { cost: sumCost });

      // Update BOM metadata on EnquiryItem
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          bomId: bomEntry.bomId,
          bomType: BOM_TYPE_2TO1,
        },
      });

      if (recalculated) {
        updatedItems.push(recalculated);
        updatedCount++;
      }
    } else {
      noCostItemCodes.add(item.erpItemCode);
    }
  }

  return {
    updatedCount,
    updatedItems,
    noCostItemCodes: [...noCostItemCodes],
    noBomItemCodes: [...noBomItemCodes],
  };
}
