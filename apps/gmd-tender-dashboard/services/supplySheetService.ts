import { getAccessToken, getCleanCredentials } from "@/lib/googleDrive";
import type { SupplyHistoryRecord } from "@/types/supplyHistory";

const SUPPLY_SPREADSHEET_ID = "1tXiJC9AZNiAAoL8mM_KxKuzrFqzuk-n3n16abJbaam0";

export async function fetchSupplyHistoryFromGoogleSheet(): Promise<SupplyHistoryRecord[]> {
  const creds = getCleanCredentials();
  if (!creds) throw new Error("Google Service Account credentials are not configured.");

  const accessToken = await getAccessToken(creds.email, creds.key);

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SUPPLY_SPREADSHEET_ID}`;
  const metaResponse = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!metaResponse.ok) {
    const text = await metaResponse.text();
    throw new Error(`Failed to fetch spreadsheet metadata: ${text}`);
  }
  const meta = (await metaResponse.json()) as { sheets?: { properties?: { title?: string } }[] };
  const sheetTitles = (meta.sheets || [])
    .map(s => s.properties?.title)
    .filter((t): t is string => !!t);
  if (sheetTitles.length === 0) throw new Error("No sheets found in the spreadsheet");

  const ranges = sheetTitles.map(t => `${t}!A1:ZZ`);
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SUPPLY_SPREADSHEET_ID}/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&")}`;

  const response = await fetch(batchUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets API returned status ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { valueRanges?: { values?: string[][] }[] };
  if (!data.valueRanges || data.valueRanges.length === 0) return [];

  const records: SupplyHistoryRecord[] = [];
  for (const valueRange of data.valueRanges) {
    const rows = valueRange.values || [];
    if (rows.length < 2) continue;
    for (const row of rows.slice(1)) {
      records.push({
    fy: row[0] || null,
    saleBillNumber: row[1] || null,
    saleBillDate: row[2] || null,
    itemCode: row[3] || null,
    itemName: row[4] || null,
    lrNo: row[5] || null,
    truckNo: row[6] || null,
    partyRefNo: row[7] || null,
    partyRefDate: row[8] || null,
    contractVrNo: row[9] || null,
    rate: row[11] !== undefined && row[11] !== "" ? parseFloat(row[11]) : null,
    invoiceQty: row[14] !== undefined && row[14] !== "" ? parseFloat(row[14]) : null,
    invoiceAmt: row[15] !== undefined && row[15] !== "" ? parseFloat(row[15]) : null,
      partyName: row[16] || null,
      });
    }
  }

  // Only keep rows where FY matches a valid financial year pattern (e.g. "25-26")
  const validFy = /^\d{2}-\d{2}$/;
  return records.filter((r) => {
    if (!r.fy || !validFy.test(r.fy)) return false;

    const itemCode = (r.itemCode ?? "").toLowerCase();
    const matchesItemCode =
      itemCode.includes("fx") || itemCode.includes("c2") || !r.itemCode?.trim();

    const matchesContractVrNo = !r.contractVrNo || r.contractVrNo.trim() === "";

    const matchesRate = r.rate === null || r.rate === 0;

    return matchesItemCode && matchesContractVrNo && matchesRate;
  });
}
