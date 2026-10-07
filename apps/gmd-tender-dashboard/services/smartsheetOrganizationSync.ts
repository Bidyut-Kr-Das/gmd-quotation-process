import { prisma } from "@/lib/prisma";

const DOCKET_NO_COLUMN = "Docket No  (Debosmita Nath)";
const PARTY_NAME_COLUMN = "Party Name  (Debosmita Nath)";

export interface OrganizationSyncStats {
  total: number;
  found: number;
  updated: number;
  notFound: number;
  errors: number;
}

interface SmartsheetColumn {
  id: number;
  title: string;
}

interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
}

interface SmartsheetSheetData {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
}

async function fetchSmartsheetData(): Promise<SmartsheetSheetData> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID;

  if (!token || token.trim() === "") {
    throw new Error("SMARTSHEET_API_TOKEN is missing or empty");
  }

  if (!sheetId || sheetId.trim() === "") {
    throw new Error("SMARTSHEET_SHEET_ID is missing or empty");
  }

  const url = `https://api.smartsheet.com/2.0/sheets/${sheetId.trim()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Smartsheet API error (${response.status}): ${body}`);
  }

  return (await response.json()) as SmartsheetSheetData;
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

export async function syncOrganizationFromSmartsheet(): Promise<OrganizationSyncStats> {
  const stats: OrganizationSyncStats = {
    total: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
  };

  let sheetData: SmartsheetSheetData;
  try {
    sheetData = await fetchSmartsheetData();
  } catch (err) {
    console.warn("[OrganizationSync] Failed to fetch Smartsheet:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  const columnIndex = new Map<string, number>();
  for (const col of sheetData.columns) {
    if (col.title) {
      columnIndex.set(col.title, col.id);
    }
  }

  const docketNoColId = columnIndex.get(DOCKET_NO_COLUMN);
  const partyNameColId = columnIndex.get(PARTY_NAME_COLUMN);

  if (!docketNoColId) {
    console.warn("[OrganizationSync] Docket No column not found. Aborting.");
    stats.errors++;
    return stats;
  }
  if (!partyNameColId) {
    console.warn("[OrganizationSync] Party Name column not found. Aborting.");
    stats.errors++;
    return stats;
  }

  const rows = sheetData.rows || [];
  const partyLookup = new Map<string, string | null>();
  for (const row of rows) {
    const cells = row.cells || [];
    const docketNo = getCellValue(cells, docketNoColId);
    if (!docketNo) continue;
    const partyName = getCellValue(cells, partyNameColId);
    partyLookup.set(docketNo.toLowerCase(), partyName);
  }

  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, docketNo: true, organization: true },
  });

  stats.total = allTenders.length;

  for (const tender of allTenders) {
    if (!tender.docketNo) {
      stats.notFound++;
      continue;
    }

    const docketLower = tender.docketNo.trim().toLowerCase();
    if (!docketLower) {
      stats.notFound++;
      continue;
    }

    const partyName = partyLookup.get(docketLower);
    if (partyName === undefined) {
      stats.notFound++;
      continue;
    }

    stats.found++;

    if (tender.organization === partyName) continue;

    try {
      console.log(`[OrganizationSync] Updating docket="${tender.docketNo}" org="${tender.organization}" -> "${partyName}"`);
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { organization: partyName },
      });
      stats.updated++;
    } catch (err) {
      console.warn(
        `[OrganizationSync] Failed to update organization for docket ${tender.docketNo}:`,
        (err as Error).message,
      );
      stats.errors++;
    }
  }

  return stats;
}
