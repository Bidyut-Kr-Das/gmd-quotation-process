import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../googleAuth";

const CONTRACT_SHEET_SPREADSHEET_ID = process.env.CONTRACT_SHEET_SPREADSHEET_ID;
const CONTRACT_SHEET_GID = 1367392830;

// GMD Clientwise — new ORDER LIST source (first sheet CONTRACTS copy)
// Spreadsheet: https://docs.google.com/spreadsheets/d/1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE/edit?gid=422553416
export const GMD_CLIENTWISE_SPREADSHEET_ID =
  process.env.GMD_CLIENTWISE_SPREADSHEET_ID ||
  "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE";
export const GMD_CLIENTWISE_GID = 422553416;
const GMD_CLIENTWISE_TITLE_FALLBACKS = ["CONTRACTS COPY", "CONTRACTS", "GMD CLIENTWISE"];

function getAuth() {
  return getOAuthClient();
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ").replace(/\n/g, "");
}

export function normalizePo(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function stripDtSuffix(value: string): string {
  // Handles "PO123 DT", "PO123 DT 09.01.25", "PO123 DT-...", etc.
  return normalizePo(value).replace(/\s+DT\b.*$/, "").trim();
}

export function matchOrderLink(
  partyOrderNo: string | null | undefined,
  map: Map<string, string>,
): string | null {
  if (!partyOrderNo) return null;
  const key = normalizePo(partyOrderNo);
  const exact = map.get(key);
  if (exact) return exact;
  const stripped = stripDtSuffix(key);
  if (stripped !== key) return map.get(stripped) ?? null;
  return null;
}

export function splitCsvLinks(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function mergeOrderListCsv(existingCsv: string | null | undefined, newCsv: string | null | undefined): string | null {
  const existing = splitCsvLinks(existingCsv);
  const incoming = splitCsvLinks(newCsv);
  if (incoming.length === 0) return existing.length ? existing.join(", ") : null;
  if (existing.length === 0) return incoming.join(", ");
  const seen = new Set(existing);
  const merged = [...existing];
  for (const link of incoming) {
    if (!seen.has(link)) {
      seen.add(link);
      merged.push(link);
    }
  }
  return merged.join(", ");
}

function splitAttachmentCell(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const str = String(raw).trim();
  if (!str) return [];
  // Cell may already contain comma/newline/semicolon separated links
  const parts = str.split(/[\n,;]+/);
  const cleaned = parts.map((s) => s.trim()).filter((s) => s.length > 0);
  // Deduplicate within cell preserving order
  return [...new Set(cleaned)];
}

export async function buildContractOrderLinkMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!CONTRACT_SHEET_SPREADSHEET_ID) return map;

  const auth = getAuth();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: CONTRACT_SHEET_SPREADSHEET_ID,
  });

  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === CONTRACT_SHEET_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) return map;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: CONTRACT_SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) return map;

  const headers = allRows[0].map(String);
  const poIdx = headers.findIndex(
    (h) => normalizeHeader(h) === "PO NO",
  );
  const attachmentIdx = headers.findIndex((h) =>
    normalizeHeader(h).includes("ATTACH"),
  );
  if (poIdx === -1 || attachmentIdx === -1) return map;

  // Aggregate unique attachments per PO (comma separated in DB)
  const agg = new Map<string, Set<string>>();
  for (const row of allRows.slice(1)) {
    const po = row[poIdx];
    const link = row[attachmentIdx];
    if (po === undefined || String(po).trim() === "") continue;
    if (link === undefined || String(link).trim() === "") continue;
    const key = normalizePo(String(po));
    const links = splitAttachmentCell(link);
    if (links.length === 0) continue;
    let set = agg.get(key);
    if (!set) {
      set = new Set<string>();
      agg.set(key, set);
    }
    for (const l of links) set.add(l);
  }
  for (const [k, set] of agg) map.set(k, [...set].join(", "));

  return map;
}

export async function buildGmdClientwiseOrderLinkMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const spreadsheetId = GMD_CLIENTWISE_SPREADSHEET_ID;
  if (!spreadsheetId) return map;

  const auth = getAuth();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = meta.data.sheets ?? [];
  if (allSheets.length === 0) return map;

  // Priority: GID 422553416 -> title CONTRACTS COPY/CONTRACTS/GMD CLIENTWISE -> first sheet
  let tab = allSheets.find((s) => s.properties?.sheetId === GMD_CLIENTWISE_GID);
  if (!tab) {
    for (const fallback of GMD_CLIENTWISE_TITLE_FALLBACKS) {
      tab = allSheets.find(
        (s) => normalizeHeader(String(s.properties?.title ?? "")) === fallback,
      );
      if (tab) break;
    }
  }
  if (!tab) {
    // First sheet rule: explicitly requested
    tab = allSheets[0];
  }
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) return map;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) return map;

  const headers = allRows[0].map(String);
  const poIdx = headers.findIndex((h) => normalizeHeader(h) === "PO NO");
  const attachmentIdx = headers.findIndex((h) => normalizeHeader(h).includes("ATTACH"));
  if (poIdx === -1 || attachmentIdx === -1) return map;

  const agg = new Map<string, Set<string>>();
  for (const row of allRows.slice(1)) {
    const po = row[poIdx];
    const link = row[attachmentIdx];
    if (po === undefined || String(po).trim() === "") continue;
    if (link === undefined || String(link).trim() === "") continue;
    const key = normalizePo(String(po));
    const links = splitAttachmentCell(link);
    if (links.length === 0) continue;
    let set = agg.get(key);
    if (!set) {
      set = new Set<string>();
      agg.set(key, set);
    }
    for (const l of links) set.add(l);
  }

  // Hyperlink fallback: some ATTACHTMENT cells are chips/formulas where FORMATTED_VALUE
  // returns display text (e.g., "Order Copy") instead of URL. Try includeGridData to
  // extract hyperlink field and merge into agg.
  try {
    const grid = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${tabTitle}'!A:ZZZ`],
      includeGridData: true,
      fields: "sheets(data(rowData(values(hyperlink,formattedValue))))",
    });
    const gridData = grid.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    // row 0 is header, so start at 1
    for (let r = 1; r < gridData.length; r++) {
      const vals = gridData[r].values ?? [];
      const poCell = vals[poIdx];
      const attCell = vals[attachmentIdx];
      if (!poCell || !attCell) continue;
      const poRaw = (poCell.formattedValue ?? "").trim();
      if (!poRaw) continue;
      const hyperlink = (attCell.hyperlink ?? "").trim();
      if (!hyperlink) continue;
      // Only merge hyperlink if it's a URL and not already in agg (or add)
      if (!/^https?:\/\//i.test(hyperlink)) continue;
      const key = normalizePo(poRaw);
      // Also consider formattedValue may have URL already; hyperlink may be duplicate
      let set = agg.get(key);
      if (!set) {
        set = new Set<string>();
        agg.set(key, set);
      }
      // hyperlink may contain single URL; split just in case
      for (const l of splitAttachmentCell(hyperlink)) set.add(l);
    }
  } catch (e) {
    // Non-fatal: values.get already populated agg
    console.warn("hyperlink grid fallback failed", e instanceof Error ? e.message : e);
  }

  for (const [k, set] of agg) map.set(k, [...set].join(", "));

  return map;
}
