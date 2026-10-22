import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { fetchSmartsheetTenders } from "@/services/tender.service";
import { getAccessToken, getCleanCredentials, getGoogleDriveFileId, getGoogleDriveDownloadUrl } from "@/lib/googleDrive";
import { findCostingSheet } from "@/services/costingSheetAnalyzer";
import type { SmartsheetTender } from "@/types/smartsheetTender";

const CACHE_DIR = path.resolve(process.cwd(), "cache");
const COSTING_SPREADSHEET_ID = "1FK1t7FeAjQ3v4saIxJUS-5KbE6YlQv-8WFQCBRuaxDQ";
const COSTING_WORKSHEET_NAME = "Cost";

function extractNumericDocket(docketStr: string | null): string | null {
  if (!docketStr || docketStr.trim() === "" || docketStr.trim() === "-") return null;
  const prefixMatch = docketStr.match(/(?:ENQ|ENG|ENC|FNO)[-_](\d+)/i);
  if (prefixMatch) return prefixMatch[1];
  const pureNum = docketStr.trim();
  if (/^\d+$/.test(pureNum)) return pureNum;
  const looseMatch = docketStr.match(/(\d{4,6})/);
  return looseMatch ? looseMatch[1] : null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

interface CostingEntry {
  url: string;
}

interface CostingDetails {
  priceBasis: string | null;
  proposedErpItemName: string | null;
  proposedQty: string | null;
  aluminiumPrice: number | null;
  aluminiumAlloyPrice: number | null;
  copperTapePrice: number | null;
  extrudedSemiconductivePrice: number | null;
  htXlpePrice: number | null;
  pvcTypeSt2Price: number | null;
  galvanisedSteelFlatStripPrice: number | null;
  fillerPrice: number | null;
  cva: string | null;
}

async function buildCostingMap(accessToken: string): Promise<Map<string, CostingEntry>> {
  const costingMap = new Map<string, CostingEntry>();
  const costingRange = `${COSTING_WORKSHEET_NAME}!A1:ZZ`;
  const costingUrl = `https://sheets.googleapis.com/v4/spreadsheets/${COSTING_SPREADSHEET_ID}/values/${encodeURIComponent(costingRange)}`;

  const costingResponse = await fetch(costingUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });

  if (!costingResponse.ok) {
    // console.warn(`[SmartsheetEnrichment] Failed to fetch costing sheet: ${costingResponse.statusText}`);
    return costingMap;
  }

  const costingData = (await costingResponse.json()) as { values?: string[][] };
  const costingRows = costingData.values || [];
  if (costingRows.length < 2) return costingMap;

  const cHeaders = costingRows[0].map((h) => h.trim());
  const pasteTmNoIdx = cHeaders.findIndex(
    (h) => normalizeHeader(h).includes("pastetmno") || normalizeHeader(h).includes("puststmno")
  );
  const enqDocketNoIdx = cHeaders.findIndex((h) => normalizeHeader(h).includes("enqdocketno"));
  const uploadCostingSheetIdx = cHeaders.findIndex((h) => normalizeHeader(h).includes("uploadcostingsheet"));

  if (uploadCostingSheetIdx === -1) return costingMap;

  for (let i = 1; i < costingRows.length; i++) {
    const cRow = costingRows[i];
    if (!cRow || cRow.length === 0) continue;

    const rawUrl = uploadCostingSheetIdx < cRow.length ? cRow[uploadCostingSheetIdx] : "";
    const rawEnqDocket = enqDocketNoIdx !== -1 && enqDocketNoIdx < cRow.length ? cRow[enqDocketNoIdx] : "";
    const rawPasteTmNo = pasteTmNoIdx !== -1 && pasteTmNoIdx < cRow.length ? cRow[pasteTmNoIdx] : "";

    if (!rawUrl || rawUrl.trim() === "-" || rawUrl.trim() === "") continue;

    let numericDocket = extractNumericDocket(rawEnqDocket);
    if (!numericDocket) numericDocket = extractNumericDocket(rawPasteTmNo);

    if (numericDocket) {
      costingMap.set(numericDocket, { url: rawUrl.trim() });
    }
  }
  return costingMap;
}

export async function getCostingDetails(
  attachmentUrl: string,
  docketNo: string,
  driveAccessToken: string | null
): Promise<CostingDetails | null> {
  if (!attachmentUrl) {
    console.warn(`[CostingDetails] Called with null attachmentUrl for docket "${docketNo}"`);
    return null;
  }

  console.log(`[CostingDetails] Starting for docket "${docketNo}"`);
  let downloadUrl: string | null = attachmentUrl;
  const headers: Record<string, string> = {};

  const fileId = getGoogleDriveFileId(attachmentUrl);
  let isLocalFile = false;

  if (fileId) {
    if (!driveAccessToken) {
      console.warn(`[SmartsheetEnrichment] No Drive access token, skipping docket "${docketNo}"`);
      return null;
    }
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    headers["Authorization"] = `Bearer ${driveAccessToken}`;
  } else if (fs.existsSync(
    /* turbopackIgnore: true */
    attachmentUrl,
  )) {
    isLocalFile = true;
    console.log(`[CostingDetails] Local file found for docket "${docketNo}": ${attachmentUrl}`);
  }

  const localPath = isLocalFile
    ? attachmentUrl
    : path.join(CACHE_DIR, `${crypto.createHash("md5").update(downloadUrl).digest("hex")}.xlsx`);

  let fileExists = fs.existsSync(localPath);

  if (!fileExists) {
    try {
      console.log(`[CostingDetails] Downloading costing Excel for docket "${docketNo}"...`);
      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) {
        console.warn(`[CostingDetails] Failed to download Excel for docket "${docketNo}": ${response.statusText}`);
        return null;
      }
      const buffer = await response.arrayBuffer();
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(localPath, Buffer.from(buffer));
      fileExists = true;
    } catch (err) {
      console.warn(`[CostingDetails] Error downloading Excel for docket "${docketNo}": ${(err as Error).message}`);
      return null;
    }
  }

  if (!fileExists) return null;

  try {
    const workbook = XLSX.readFile(localPath);
    const sheetName = findCostingSheet(workbook);
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) {
      // console.warn(`[SmartsheetEnrichment] Costing sheet not found for docket "${docketNo}"`);
      return null;
    }

    // Price Basis
    let priceBasis = "Firm";
    for (let c = 0; c < 5; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 7, c });
      const cell = sheet[cellRef];
      if (cell && cell.v) {
        const valStr = String(cell.v);
        if (valStr.toLowerCase().includes("variable")) priceBasis = "Variable";
      }
    }

    // Material prices
    const prices: Record<string, number | null> = {
      aluminium: null,
      aluminiumAlloy: null,
      copperTape: null,
      extrudedSemiconductive: null,
      htXlpe: null,
      pvcTypeSt2: null,
      galvanisedSteelFlatStrip: null,
      filler: null,
    };

    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:ZZ100");

    const patterns: Record<string, RegExp> = {
      aluminium: /^(aluminium|alumimium)$/i,
      aluminiumAlloy: /^(aluminium alloy|alumimium alloy)$/i,
      copperTape:
        /^(copper tape - 0\.060? mm|copper tape - 0\.06 mm|coper tape - 0\.1 mm|copper tape - 0\.03 mm|copper tape - 0\.035 mm|copper tape - 0\.04 mm|copper tape - 0\.045 mm|copper tape - 0\.050? mm|copper tape)$/i,
      extrudedSemiconductive: /^(extruded semiconductive|extruded semiconductive\(stripable\))$/i,
      htXlpe: /^(ht-xlpe|lt-xlpe|tr xlpe|xlpe)$/i,
      pvcTypeSt2: /^(pvc type st-2|fr pvc type st-2|frlsh pvc type st-2|pvc type st-2-pressure extruded)$/i,
      galvanisedSteelFlatStrip: /^(galvanised steel flat strip|galvanised steel flat strip \(double\)|galvanised steel flat strip-b|galvanised steel round wire|galvanised steel round wire \(double\))$/i,
      filler: /^filler$/i,
    };

    // Find material header row
    let bestRowIdx = -1;
    let maxMatchCount = 0;
    const maxSearchRow = Math.min(range.e.r, 40);

    for (let r = 0; r <= maxSearchRow; r++) {
      let matchCount = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[cellRef];
        if (cell && cell.v !== undefined) {
          const valStr = String(cell.v).trim().toLowerCase();
          if (Object.values(patterns).some((re) => re.test(valStr))) matchCount++;
        }
      }
      if (matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        bestRowIdx = r;
      }
    }

    if (bestRowIdx !== -1 && maxMatchCount > 0) {
      const rowRateIdx = bestRowIdx + 1;
      if (rowRateIdx <= range.e.r) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const headerCell = sheet[XLSX.utils.encode_cell({ r: bestRowIdx, c })];
          const rateCell = sheet[XLSX.utils.encode_cell({ r: rowRateIdx, c })];
          if (!headerCell) continue;
          const header = String(headerCell.v).trim().toLowerCase();
          const rateVal = rateCell && rateCell.v !== undefined && rateCell.v !== "" ? Number(rateCell.v) : null;
          if (rateVal === null || isNaN(rateVal)) continue;

          for (const [key, pattern] of Object.entries(patterns)) {
            if (pattern.test(header)) {
              if (prices[key] === null || prices[key] === 0) prices[key] = rateVal;
            }
          }
        }
      }
    }

    // Extract ERP items and quantities
    const erpItems: string[] = [];
    const qtyItems: string[] = [];

    let erpHeaderRowIdx = -1;
    let erpColIdx = -1;
    let qtyColIdx = -1;
    let unitColIdx = -1;

    const normalizeCellHeader = (s: unknown): string =>
      String(s || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== undefined) {
          const norm = normalizeCellHeader(cell.v);
          if (norm.includes("PROPOSE ERP ITEM") || norm.includes("PROPOSED ERP ITEM")) {
            erpHeaderRowIdx = r;
            erpColIdx = c;
          } else if (norm === "QTY" || norm.startsWith("QTY ") || norm === "QUANTITY") {
            qtyColIdx = c;
          } else if (norm === "UNIT") {
            unitColIdx = c;
          }
        }
      }
      if (erpHeaderRowIdx !== -1) break;
    }

    if (erpHeaderRowIdx !== -1 && erpColIdx !== -1) {
      const seenItems = new Set<string>();
      const normalizeAlphaNum = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

      for (let r = erpHeaderRowIdx + 1; r <= range.e.r; r++) {
        const docketCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
        if (!docketCell || docketCell.v === undefined) continue;

        const sheetDocketNorm = normalizeAlphaNum(String(docketCell.v));
        const paramDocketNorm = normalizeAlphaNum(docketNo);
        if (!paramDocketNorm || (!sheetDocketNorm.includes(paramDocketNorm) && !paramDocketNorm.includes(sheetDocketNorm))) continue;

        const erpCell = sheet[XLSX.utils.encode_cell({ r, c: erpColIdx })];
        if (erpCell && erpCell.v !== undefined && String(erpCell.v).trim() !== "") {
          const erpVal = String(erpCell.v).trim();
          if (erpVal.toUpperCase().includes("PROPOSE") || erpVal.toLowerCase().includes("total") || erpVal.toLowerCase().includes("sum")) continue;

          let qtyVal = "";
          let qtyNum: number | null = null;
          if (qtyColIdx !== -1) {
            const qtyCell = sheet[XLSX.utils.encode_cell({ r, c: qtyColIdx })];
            if (qtyCell && qtyCell.v !== undefined) {
              qtyVal = String(qtyCell.v).trim();
              qtyNum = Number(qtyVal.replace(/[^\d.-]/g, ""));
            }
          }

          let unitVal = "";
          if (unitColIdx !== -1) {
            const unitCell = sheet[XLSX.utils.encode_cell({ r, c: unitColIdx })];
            if (unitCell && unitCell.v !== undefined) unitVal = String(unitCell.v).trim();
          }

          if (qtyNum !== null && !isNaN(qtyNum)) {
            qtyVal = unitVal.toUpperCase().includes("KM") ? String(Math.round(qtyNum * 1000)) : String(Math.round(qtyNum));
          }

          const itemKey = `${erpVal}::${qtyVal}`;
          if (!seenItems.has(itemKey)) {
            seenItems.add(itemKey);
            erpItems.push(erpVal);
            qtyItems.push(qtyVal);
          }
        }
      }
    }

    let cvaMfg: number | null = null;
    let cvaIntt: number | null = null;
    let cvaInsp: number | null = null;

    const normalizeHeaderText = (h: string): string =>
      h.trim().toLowerCase().replace(/[^\w]/g, "");

    console.log(`[CVA] Scanning ${workbook.SheetNames.length} sheets for docket "${docketNo}"...`);
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws || !ws["!ref"]) continue;
      const wsRange = XLSX.utils.decode_range(ws["!ref"]);

      for (let r = wsRange.s.r; r <= Math.min(wsRange.e.r, 40); r++) {
        for (let c = wsRange.s.c; c <= wsRange.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell || cell.v === undefined) continue;
          const raw = String(cell.v).trim().toLowerCase();
          const norm = normalizeHeaderText(raw);

          let key: "mfg" | "intt" | "insp" | null = null;
          if (norm === "mfg" || norm === "mfgpercentage" || norm === "mfgpercent" || norm === "mfgr") key = "mfg";
          else if (norm === "intt" || norm === "inttpercentage" || norm === "inttpercent") key = "intt";
          else if (norm === "insp" || norm === "insppercentage" || norm === "insppercent" || norm === "inspection") key = "insp";
          if (!key) continue;

          console.log(`[CVA] Found header "${raw}" (norm="${norm}") as "${key}" at sheet="${sheetName}" row=${r} col=${c}`);

          const valRow = r + 2;
          if (valRow > wsRange.e.r) {
            console.warn(`[CVA] Value row ${valRow} out of range (max ${wsRange.e.r}), skipping.`);
            continue;
          }
          const valCell = ws[XLSX.utils.encode_cell({ r: valRow, c })];
          if (!valCell || valCell.v === undefined || valCell.v === "") {
            console.warn(`[CVA] Value cell at row=${valRow} col=${c} is empty.`);
            continue;
          }
          const cleaned = String(valCell.v).replace(/[^\d.-]/g, "");
          const num = parseFloat(cleaned);
          if (!isNaN(num)) {
            if (key === "mfg" && cvaMfg === null) cvaMfg = num;
            else if (key === "intt" && cvaIntt === null) cvaIntt = num;
            else if (key === "insp" && cvaInsp === null) cvaInsp = num;
            console.log(`[CVA] Parsed ${key}=${num} (raw cell: "${String(valCell.v)}", cleaned: "${cleaned}")`);
          } else {
            console.warn(`[CVA] Could not parse number from cell value "${String(valCell.v)}" (cleaned: "${cleaned}")`);
          }
        }
      }
    }

    const cvaParts: string[] = [];
    if (cvaMfg !== null) cvaParts.push(String(cvaMfg));
    if (cvaIntt !== null) cvaParts.push(String(cvaIntt));
    if (cvaInsp !== null) cvaParts.push(String(cvaInsp));
    const cva = cvaParts.length > 0 ? cvaParts.join("@") : null;
    console.log(`[CVA] Result for docket "${docketNo}": mfg=${cvaMfg} intt=${cvaIntt} insp=${cvaInsp} → cva="${cva}"`);

    return {
      priceBasis,
      proposedErpItemName: erpItems.join("\n") || null,
      proposedQty: qtyItems.join("\n") || null,
      aluminiumPrice: prices.aluminium,
      aluminiumAlloyPrice: prices.aluminiumAlloy,
      copperTapePrice: prices.copperTape,
      extrudedSemiconductivePrice: prices.extrudedSemiconductive,
      htXlpePrice: prices.htXlpe,
      pvcTypeSt2Price: prices.pvcTypeSt2,
      galvanisedSteelFlatStripPrice: prices.galvanisedSteelFlatStrip,
      fillerPrice: prices.filler,
      cva,
    };
  } catch (err) {
    // console.warn(`[SmartsheetEnrichment] Error parsing Excel for docket "${docketNo}": ${(err as Error).message}`);
    try {
      fs.unlinkSync(localPath);
    } catch {}
    return null;
  }
}

export async function fetchAndEnrichSmartsheetTenders(): Promise<SmartsheetTender[]> {
  const records = await fetchSmartsheetTenders();
  if (!records || records.length === 0) return [];

  const creds = getCleanCredentials();
  if (!creds) {
    // console.warn("[SmartsheetEnrichment] No Google credentials, returning basic records");
    return records;
  }

  let driveAccessToken: string | null = null;
  try {
    driveAccessToken = await getAccessToken(creds.email, creds.key);
  } catch (err) {
    // console.warn(`[SmartsheetEnrichment] Failed to get Drive token: ${(err as Error).message}`);
    return records;
  }

  const costingMap = await buildCostingMap(driveAccessToken);

  const enriched: SmartsheetTender[] = [];
  for (const row of records) {
    const numericDocket = extractNumericDocket(row.docketNumber);
    let attachmentUrl: string | null = null;
    let costing: CostingDetails | null = null;

    if (numericDocket && costingMap.has(numericDocket)) {
      const match = costingMap.get(numericDocket)!;
      attachmentUrl = getGoogleDriveDownloadUrl(match.url);
      try {
        costing = await getCostingDetails(match.url, numericDocket, driveAccessToken);
      } catch (err) {
        // console.warn(`[SmartsheetEnrichment] Failed to enrich docket "${numericDocket}": ${(err as Error).message}`);
      }
    }

    enriched.push({
      ...row,
      attachmentUrl,
      proposedErpItemName: costing?.proposedErpItemName ?? null,
      proposedQty: costing?.proposedQty ?? null,
      priceBasis: costing?.priceBasis ?? null,
      aluminiumPrice: costing?.aluminiumPrice ?? null,
      aluminiumAlloyPrice: costing?.aluminiumAlloyPrice ?? null,
      copperTapePrice: costing?.copperTapePrice ?? null,
      extrudedSemiconductivePrice: costing?.extrudedSemiconductivePrice ?? null,
      htXlpePrice: costing?.htXlpePrice ?? null,
      pvcTypeSt2Price: costing?.pvcTypeSt2Price ?? null,
      galvanisedSteelFlatStripPrice: costing?.galvanisedSteelFlatStripPrice ?? null,
      fillerPrice: costing?.fillerPrice ?? null,
    });
  }

  return enriched;
}
