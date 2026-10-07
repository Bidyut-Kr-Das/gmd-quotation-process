import { prisma } from "@/lib/prisma";

const TENDER_MASTER_NO_COLUMN = "TENDER MASTER NO";
const BENEFICIARY_BANK_DETAILS_COLUMN = "Beneficiary Bank Details";

export interface LcBeneficiarySyncStats {
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

async function fetchLcSmartsheet(): Promise<SmartsheetSheetData> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const sheetId = process.env.LC_SMARTSHEET_ID;

  if (!token || token.trim() === "") {
    throw new Error("SMARTSHEET_API_TOKEN is missing or empty");
  }

  if (!sheetId || sheetId.trim() === "") {
    throw new Error("LC_SMARTSHEET_ID is missing or empty");
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

export async function syncBeneficiaryBankDetails(): Promise<LcBeneficiarySyncStats> {
  const stats: LcBeneficiarySyncStats = {
    total: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
  };

  let sheetData: SmartsheetSheetData;
  try {
    sheetData = await fetchLcSmartsheet();
  } catch (err) {
    console.warn("[LcSmartsheet] Failed to fetch LC Smartsheet:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  const columnIndex = new Map<string, number>();
  for (const col of sheetData.columns) {
    if (col.title) {
      columnIndex.set(col.title, col.id);
    }
  }

  const tenderMasterNoColId = columnIndex.get(TENDER_MASTER_NO_COLUMN);
  const beneficiaryBankColId = columnIndex.get(BENEFICIARY_BANK_DETAILS_COLUMN);

  if (!tenderMasterNoColId) {
    console.warn("[LcSmartsheet] TENDER MASTER NO column not found. Aborting.");
    stats.errors++;
    return stats;
  }
  if (!beneficiaryBankColId) {
    console.warn("[LcSmartsheet] Beneficiary Bank Details column not found. Aborting.");
    stats.errors++;
    return stats;
  }

  const rows = sheetData.rows || [];

  // Extract GEM numbers from TENDER MASTER NO handling various formats:
  //   "GEM/2026/B/7542622"           (raw)
  //   "GeM bid no. GEM/2026/B/7510496" (with prefix)
  //   "GeM Bid no. GEM/2026/B/7510391" (with prefix, different casing)
  const bankLookup = new Map<string, string | null>();
  for (const row of rows) {
    const cells = row.cells || [];
    const tenderMasterNo = getCellValue(cells, tenderMasterNoColId);
    if (!tenderMasterNo || tenderMasterNo === "0") continue;
    const bankDetails = getCellValue(cells, beneficiaryBankColId);

    const gemMatch = tenderMasterNo.match(/(GEM\/\d{4}\/[A-Z]\/\d+)/i);
    if (gemMatch) {
      const gemKey = gemMatch[1].toLowerCase();
      if (!bankLookup.has(gemKey)) {
        bankLookup.set(gemKey, bankDetails);
      }
    } else {
      bankLookup.set(tenderMasterNo.toLowerCase(), bankDetails);
    }
  }

  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, referenceNo: true },
  });

  stats.total = allTenders.length;

  for (const tender of allTenders) {
    if (!tender.referenceNo) {
      stats.notFound++;
      continue;
    }

    const refNoLower = tender.referenceNo.trim().toLowerCase();
    if (!refNoLower) {
      stats.notFound++;
      continue;
    }

    const bankDetails = bankLookup.get(refNoLower);
    if (bankDetails === undefined) {
      stats.notFound++;
      continue;
    }

    stats.found++;

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { beneficiaryBankDetails: bankDetails },
      });
      stats.updated++;
    } catch (err) {
      console.warn(
        `[LcSmartsheet] Failed to update beneficiaryBankDetails for ${tender.referenceNo}:`,
        (err as Error).message,
      );
      stats.errors++;
    }
  }

  return stats;
}
