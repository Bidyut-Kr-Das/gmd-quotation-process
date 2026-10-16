import * as XLSX from "xlsx";
import type {
  MaterialPattern,
  MaterialMatch,
  CostingAnalysisResult,
  CostingItem,
  ColumnMap,
  RawMaterialsMap,
} from "@/types/costing";

const MATERIAL_PATTERNS: MaterialPattern[] = [
  { key: "aluminium", patterns: [/^alumini?um$/i, /^al$/i, /^al\.$/i] },
  { key: "aluminiumAlloy", patterns: [/^alumini?um\s+alloy$/i, /^al\.?\s*alloy$/i] },
  { key: "copperTape", patterns: [/^copper/i] },
  { key: "extrudedSemiconductive", patterns: [/^extruded\s+semiconductive/i, /^semiconductive$/i, /^semicon$/i] },
  { key: "htXlpe", patterns: [/^ht[\s-]?xlpe$/i, /^lt[\s-]?xlpe$/i, /^tr\s+xlpe$/i, /^xlpe$/i] },
  { key: "pvc", patterns: [/^pvc$/i] },
  { key: "pvcTypeSt1", patterns: [/^pvc\s+type\s+st[\s-]?1$/i, /^pvc\s+st[\s-]?1$/i, /^pvc[\s-]1$/i] },
  { key: "pvcTypeSt2", patterns: [/^pvc\s+type\s+st[\s-]?2$/i, /^pvc\s+st[\s-]?2$/i, /^st[\s-]2$/i, /^pvc[\s-]?2$/i] },
  { key: "innerSheath", patterns: [/^inner\s+sheath/i, /^inner\s+sheathing/i, /^inner$/i] },
  { key: "armouring", patterns: [/^armour/i] },
  { key: "galvanisedSteelRoundWire", patterns: [/^galvanis/i, /^g\.?\s*i\.?\s*wire/i, /^steel\s+round\s+wire/i, /^steel\s+wire/i] },
  { key: "galvanisedSteelFlatStrip", patterns: [/^galvanis/i, /^steel\s+flat/i] },
  { key: "outerSheath", patterns: [/^outer\s+sheath/i, /^outer\s+sheathing/i, /^outer$/i] },
  { key: "filler", patterns: [/^filler$/i] },
  { key: "waterSwellableTape", patterns: [/^water\s+swellable/i, /^swellable\s+tape/i, /^wst$/i] },
  { key: "rpct", patterns: [/^rpct$/i, /^r\.?\s*p\.?\s*c\.?\s*t\.?$/i] },
];

const QTY_PATTERNS = [/^qty$/i, /^qty\.$/i, /^quantity$/i, /^quantity\(/i, /^qty\(/i];

function normalizeHeader(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.trim().toLowerCase().replace(/[\s]+/g, " ").replace(/[^\w\s]/g, "").trim();
}

function matchMaterial(headerText: string): MaterialMatch[] | null {
  const normalized = normalizeHeader(headerText);
  if (!normalized) return null;

  const results: MaterialMatch[] = [];
  for (const entry of MATERIAL_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(normalized)) {
        results.push({ key: entry.key, pattern, normalized });
        break;
      }
    }
  }
  return results.length > 0 ? results : null;
}

function isQtyHeader(headerText: string): boolean {
  const normalized = normalizeHeader(headerText);
  if (!normalized) return false;
  return QTY_PATTERNS.some((p) => p.test(normalized));
}

function isLikelyHeaderCell(text: unknown): boolean {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  if (t.length === 0) return false;
  if (/^[\d.,%]+$/.test(t)) return false;
  return true;
}

function normalizeSheetName(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function findCostingSheet(workbook: XLSX.WorkBook, preferredName = "AUTO CALCULATION SHEET (2)"): string | null {
  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    return null;
  }

  const preferredNormalized = normalizeSheetName(preferredName);
  const exactMatch = workbook.SheetNames.find((name) => normalizeSheetName(name) === preferredNormalized);
  if (exactMatch) {
    return exactMatch;
  }

  let bestSheetName = workbook.SheetNames[0];
  let bestScore = -1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    let score = 0;
    const normalizedName = normalizeSheetName(sheetName);

    if (preferredNormalized && normalizedName) {
      if (normalizedName === preferredNormalized) {
        score += 100;
      } else if (normalizedName.includes(preferredNormalized) || preferredNormalized.includes(normalizedName)) {
        score += 80;
      } else if (
        (normalizedName.includes("calculation") || normalizedName.includes("auto")) &&
        (preferredNormalized.includes("calculation") || preferredNormalized.includes("auto"))
      ) {
        score += 40;
      }
    }

    if (normalizedName.includes("calculation") || normalizedName.includes("cost")) {
      score += 20;
    }

    if (sheet && sheet["!ref"]) {
      const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, defval: null });
      if (rows && rows.length > 0) {
        const headerRowIdx = detectHeaderRow(rows, 20);
        if (headerRowIdx !== -1) {
          const headers = rows[headerRowIdx].map((c) => c !== null && c !== undefined ? String(c) : "");
          const { qtyCol, materialCols } = buildColumnMap(headers);
          score += 50 + (materialCols.size * 10) + (qtyCol !== -1 ? 10 : 0);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sheetName;
    }
  }

  return bestSheetName;
}

function mergeRowHeaders(parentRow: (string | null)[], childRow: (string | null)[]): (string | null)[] {
  if (!childRow || childRow.length === 0) return parentRow;
  return parentRow.map((parent, i) => {
    const child = i < childRow.length ? childRow[i] : null;
    if (child && typeof child === "string" && child.trim()) {
      const parentStr = parent && typeof parent === "string" ? parent.trim() : "";
      if (parentStr && !parentStr.toLowerCase().includes(child.trim().toLowerCase())) {
        return `${parentStr} ${child.trim()}`;
      }
      return parentStr || child.trim();
    }
    return parent && typeof parent === "string" ? parent.trim() : parent || null;
  });
}

function detectHeaderRow(rows: (string | null)[][], maxLookup = 20): number {
  let bestRow = -1;
  let bestScore = 0;

  for (let r = 0; r < Math.min(maxLookup, rows.length); r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    let qtyFound = false;
    let materialCount = 0;
    let textCellCount = 0;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell || typeof cell !== "string") continue;
      const text = cell.trim();
      if (!text) continue;

      if (!isLikelyHeaderCell(text)) continue;
      textCellCount++;

      if (isQtyHeader(text)) {
        qtyFound = true;
      }

      const matched = matchMaterial(text);
      if (matched) {
        materialCount++;
      }
    }

    if (textCellCount < 2) continue;

    let score = 0;
    if (qtyFound) score += 10;
    score += materialCount * 3;

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  if (bestScore < 10) return -1;
  return bestRow;
}

function buildColumnMap(headers: string[]): ColumnMap {
  let qtyCol = -1;
  const materialCols = new Map<string, number>();

  for (let c = 0; c < headers.length; c++) {
    const header = headers[c];
    if (!header || typeof header !== "string") continue;
    const text = header.trim();
    if (!text) continue;

    if (isQtyHeader(text)) {
      qtyCol = c;
      continue;
    }

    const matched = matchMaterial(text);
    if (matched) {
      for (const m of matched) {
        if (!materialCols.has(m.key)) {
          materialCols.set(m.key, c);
        }
      }
    }
  }

  return { qtyCol, materialCols };
}

function isNumeric(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return true;
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/,/g, "");
    return cleaned.length > 0 && !isNaN(Number(cleaned));
  }
  return false;
}

function parseNumeric(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return String(val);
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/,/g, "");
    if (cleaned.length > 0 && !isNaN(Number(cleaned))) {
      return cleaned;
    }
  }
  return String(val);
}

const analysisCache = new Map<string, CostingAnalysisResult>();

export function analyzeCostingSheet(filePath: string): CostingAnalysisResult {
  try {
    const workbook = XLSX.readFile(filePath);

    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      console.warn(`[Analyzer] No sheets found in workbook: ${filePath}`);
      return { items: [], materialsFound: [], sheetName: null };
    }

    const sheetName = findCostingSheet(workbook);
    if (!sheetName) {
      return { items: [], materialsFound: [], sheetName: null };
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`[Analyzer] Sheet "${sheetName}" not found: ${filePath}`);
      return { items: [], materialsFound: [], sheetName };
    }

    const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, defval: null });

    if (!rows || rows.length === 0) {
      console.warn(`[Analyzer] Sheet "${sheetName}" is empty: ${filePath}`);
      return { items: [], materialsFound: [], sheetName };
    }

    const headerRowIdx = detectHeaderRow(rows, 20);
    if (headerRowIdx === -1) {
      console.warn(`[Analyzer] Could not detect header row in sheet "${sheetName}": ${filePath}`);
      return { items: [], materialsFound: [], sheetName };
    }

    let headers = rows[headerRowIdx].map((c): string | null =>
      c !== null && c !== undefined ? String(c) : null
    );

    let mergeDepth = 0;
    for (let r = headerRowIdx + 1; r < Math.min(headerRowIdx + 4, rows.length); r++) {
      const subRow = rows[r];
      if (!subRow) break;

      let hasText = false;
      let hasNumber = false;
      for (let c = 0; c < Math.min(subRow.length, headers.length); c++) {
        const val = subRow[c];
        if (val === null || val === undefined) continue;
        if (typeof val === "string" && val.trim()) {
          const t = val.trim();
          if (isLikelyHeaderCell(t) && t.length < 25) {
            hasText = true;
          }
        }
        if (isNumeric(val)) {
          hasNumber = true;
        }
      }

      if (hasText && !hasNumber) {
        headers = mergeRowHeaders(headers, subRow.map((c): string | null =>
          c !== null && c !== undefined ? String(c) : null
        ));
        mergeDepth++;
      } else {
        break;
      }
    }

    const { qtyCol, materialCols } = buildColumnMap(headers as string[]);

    if (qtyCol === -1) {
      console.warn(`[Analyzer] No QTY column found in sheet "${sheetName}"`);
    }

    const materialsFound = Array.from(materialCols.keys());
    if (materialsFound.length === 0) {
      console.warn(`[Analyzer] No material columns found in sheet "${sheetName}"`);
    }

    const items: CostingItem[] = [];
    const dataStartRow = headerRowIdx + 1 + mergeDepth;

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const qtyValue = qtyCol >= 0 && qtyCol < row.length ? row[qtyCol] : null;
      const qtyParsed = parseNumeric(qtyValue);

      const rawMaterials: RawMaterialsMap = {};
      let hasAnyMaterial = false;

      for (const [matKey, matCol] of materialCols) {
        const matValue = matCol < row.length ? row[matCol] : null;
        const matParsed = parseNumeric(matValue);
        if (matParsed !== null) {
          rawMaterials[matKey] = matParsed;
          hasAnyMaterial = true;
        } else {
          rawMaterials[matKey] = null;
        }
      }

      if (qtyParsed === null && !hasAnyMaterial) continue;

      items.push({
        qty: qtyParsed,
        rawMaterials,
      });
    }

    return { items, materialsFound, sheetName };
  } catch (err) {
    console.warn(`[Analyzer] Error analyzing costing sheet "${filePath}": ${(err as Error).message}`);
    return { items: [], materialsFound: [], sheetName: null };
  }
}

export default analyzeCostingSheet;

export function analyzeCostingSheetCached(filePath: string, docketNo?: string): CostingAnalysisResult {
  try {
    if (!docketNo) {
      return analyzeCostingSheet(filePath);
    }
    if (analysisCache.has(docketNo)) {
      return analysisCache.get(docketNo)!;
    }
    const result = analyzeCostingSheet(filePath);
    analysisCache.set(docketNo, result);
    return result;
  } catch {
    return { items: [], materialsFound: [], sheetName: null };
  }
}
