import * as google from "@googleapis/sheets";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { getGoogleClients } from "@/lib/gdrive";

const CONTRACT_REGISTER_SPREADSHEET_ID = "1Nar-3d8BsAIBPOonX-A9-J1tRfZDED5_S1njoHRke0Y";
const HEADER_SEARCH_ROWS = 10;

export interface ContractQuotationSyncStats {
  totalContracts: number;
  matched: number;
  updated: number;
  notFound: number;
  errors: string[];
}

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isContractHeader(h: unknown): boolean {
  const norm = normalizeHeader(h);
  return norm.includes("contract") || norm.includes("ordernumber");
}

function isQuotationHeader(h: unknown): boolean {
  const norm = normalizeHeader(h);
  return norm === "qtno" || norm === "quotationno" || norm === "quotno";
}

/**
 * Reads the contract register Google Sheet (via OAuth2) and maps
 * "Contract Number" (first column) -> "QT NO" (quotation number).
 * Updates SupplyHistory.quotationNo where contractVrNo matches.
 */
export async function syncContractQuotationNumbers(): Promise<ContractQuotationSyncStats> {
  const stats: ContractQuotationSyncStats = {
    totalContracts: 0,
    matched: 0,
    updated: 0,
    notFound: 0,
    errors: [],
  };

  const { oauth2Client } = getGoogleClients();
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  let sheetTitles: string[] = [];
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: CONTRACT_REGISTER_SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });
    sheetTitles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => !!t);
  } catch (err: any) {
    stats.errors.push(`Failed to fetch spreadsheet metadata: ${err.message}`);
    return stats;
  }

  if (sheetTitles.length === 0) {
    stats.errors.push("No tabs found in the contract register spreadsheet");
    return stats;
  }

  const ranges = sheetTitles.map((t) => `${t}!A1:ZZ`);
  let valueRanges: { range?: string | null; values?: any[][] | null }[] = [];
  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: CONTRACT_REGISTER_SPREADSHEET_ID,
      ranges,
    });
    valueRanges = response.data.valueRanges ?? [];
  } catch (err: any) {
    stats.errors.push(`Failed to read spreadsheet values: ${err.message}`);
    return stats;
  }

  const lookup = new Map<string, string>();

  for (const valueRange of valueRanges) {
    const rows = valueRange.values ?? [];
    if (rows.length === 0) continue;

    let headerRowIdx = -1;
    let quotationColIdx = -1;

    for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
      const row = rows[r] ?? [];
      if (!isContractHeader(row[0])) continue;
      const qIdx = row.findIndex((h) => isQuotationHeader(h));
      if (qIdx === -1) continue;
      headerRowIdx = r;
      quotationColIdx = qIdx;
      break;
    }

    if (headerRowIdx === -1) continue;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const contractNo = String(row[0] ?? "").trim();
      const quotationNo = String(row[quotationColIdx] ?? "").trim();
      if (!contractNo || !quotationNo) continue;
      if (lookup.has(contractNo)) continue;
      lookup.set(contractNo, quotationNo);
    }
  }

  stats.totalContracts = lookup.size;
  if (lookup.size === 0) {
    stats.errors.push("No contract -> quotation mappings found in the spreadsheet");
    return stats;
  }

  const limit = pLimit(10);
  const tasks = [...lookup.entries()].map(([contractNo, quotationNo]) =>
    limit(async () => {
      try {
        const result = await prisma.supplyHistory.updateMany({
          where: { contractVrNo: contractNo },
          data: { quotationNo },
        });
        if (result.count > 0) {
          stats.matched += result.count;
          stats.updated += result.count;
        } else {
          stats.notFound++;
        }
      } catch (err: any) {
        stats.errors.push(`Failed to update contract ${contractNo}: ${err.message}`);
      }
    }),
  );

  await Promise.all(tasks);

  console.log(
    `[ContractQuotationSync] Synced quotation numbers: ${stats.updated} records updated (${stats.totalContracts} contracts, ${stats.notFound} not found, ${stats.errors.length} errors)`,
  );

  return stats;
}
