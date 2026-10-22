/**
 * Stateful parser to parse clipboard text copied from Excel, Google Sheets, PDF, Word, or BOQs.
 * It merges wrapped multi-line descriptions and extracts the final numeric value as the quantity.
 * When pasted data contains a header row (e.g. "Item | Qty | Cost | VA%"), columns are mapped by
 * header name so Cost and VA% are captured as well.
 */
export interface ParsedItem {
  itemName: string;
  quantity: number;
  cost?: number;
  vaPercent?: number;
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const cleanDescription = (desc: string): string => {
  return desc
    .replace(/^\d+[\s\.)\-]+/g, "") // Clean leading list numbers like "1.", "2)", "3-"
    .replace(/^['"“”\s]+|['"“”\s]+$/g, "") // Strip leading/trailing quotes and spaces
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .trim();
};

const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;

const parseNumber = (s: string): number | undefined => {
  const clean = s.replace(/,/g, "").trim();
  if (!clean) return undefined;
  const n = parseFloat(clean);
  return isNaN(n) ? undefined : n;
};

const parsePercent = (s: string): number | undefined => {
  const clean = s.replace(/,/g, "").trim().replace(/%$/, "").trim();
  if (!clean) return undefined;
  const n = parseFloat(clean);
  return isNaN(n) ? undefined : n;
};

const QTY_HEADERS = new Set(["qty", "quantity", "nos", "count"]);
const VA_HEADERS = new Set(["va", "vapercent", "margin", "markup"]);
const COST_HEADERS = new Set([
  "cost",
  "rate",
  "unitrate",
  "unitprice",
  "unitcost",
  "price",
  "basic",
  "amount",
  "netrate",
  "netprice",
  "value",
]);
const NAME_HEADERS = new Set([
  "item",
  "itemname",
  "items",
  "description",
  "particular",
  "particulars",
  "material",
  "product",
  "partname",
  "partdescription",
  "specification",
  "nomenclature",
  "boqitem",
  "details",
  "name",
]);

const classifyHeader = (cell: string): "name" | "qty" | "cost" | "va" | null => {
  const norm = alnum(cell);
  if (!norm) return null;
  if (QTY_HEADERS.has(norm)) return "qty";
  if (VA_HEADERS.has(norm)) return "va";
  if (COST_HEADERS.has(norm)) return "cost";
  if (NAME_HEADERS.has(norm)) return "name";
  return null;
};

const mapHeader = (cells: string[]): Record<string, number> => {
  const map: Record<string, number> = {};
  cells.forEach((cell, i) => {
    const kind = classifyHeader(cell);
    if (kind && map[kind] === undefined) map[kind] = i;
  });
  return map;
};

// Detect a header row and parse the remaining rows by mapped column indices.
const tryParseHeaderCsv = (text: string): ParsedItem[] | null => {
  const lines = text.split(/\r?\n/);

  let headerMap: Record<string, number> = {};
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.includes("\t")) return null;
    const cells = line.split("\t").map((c) => c.trim());
    if (cells.length < 2) return null;
    headerMap = mapHeader(cells);
    if (headerMap.name !== undefined || headerMap.qty !== undefined) {
      headerIdx = i;
      break;
    }
    return null; // First non-empty line doesn't look like a header
  }
  if (headerIdx === -1) return null;

  const result: ParsedItem[] = [];
  let accumulated: string[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.includes("\t")) {
      const cells = line.split("\t").map((c) => c.trim());
      const nameCell =
        headerMap.name !== undefined
          ? cells[headerMap.name] ?? ""
          : accumulated.join(" ");
      const qtyRaw = headerMap.qty !== undefined ? cells[headerMap.qty] ?? "" : "";
      const costRaw = headerMap.cost !== undefined ? cells[headerMap.cost] ?? "" : "";
      const vaRaw = headerMap.va !== undefined ? cells[headerMap.va] ?? "" : "";

      const itemName = cleanDescription(nameCell.trim());
      const qtyVal = parseFloat(qtyRaw.replace(/,/g, ""));
      const item: ParsedItem = {
        itemName,
        quantity: isNaN(qtyVal) || qtyVal <= 0 ? 1 : qtyVal,
      };
      const cost = parseNumber(costRaw);
      const vaPercent = parsePercent(vaRaw);
      if (cost !== undefined) item.cost = cost;
      if (vaPercent !== undefined) item.vaPercent = vaPercent;
      if (itemName) result.push(item);
      accumulated = [];
    } else {
      // Wrapped name continuation line
      accumulated.push(line);
    }
  }

  if (accumulated.length > 0) {
    const itemName = cleanDescription(accumulated.join(" "));
    if (itemName) result.push({ itemName, quantity: 1 });
  }

  return result.length > 0 ? result : null;
};

// Conservative fallback for headerless tab rows shaped like [Name, Qty, Cost, VA%].
const tryParseTrailingCostVa = (
  cells: string[]
): { name: string; quantity: number; cost?: number; vaPercent?: number } | null => {
  if (cells.length < 4) return null;

  const last = cells[cells.length - 1];
  const secondLast = cells[cells.length - 2];
  const lastClean = last.replace(/,/g, "").trim().replace(/%$/, "").trim();
  if (!lastClean) return null;
  const lastNum = parseFloat(lastClean);
  const lastLooksNumeric = !isNaN(lastNum) && /^\d/.test(lastClean);
  if (!lastLooksNumeric) return null;
  const cost = parseNumber(secondLast);
  if (cost === undefined) return null;

  const leading = cells.slice(0, cells.length - 2);
  let qtyIdx = -1;
  let qtyVal = NaN;
  for (let j = leading.length - 1; j >= 0; j--) {
    const clean = leading[j].replace(/,/g, "").trim();
    const v = parseFloat(clean);
    if (!isNaN(v) && v > 0 && NUMERIC_PATTERN.test(clean)) {
      qtyIdx = j;
      qtyVal = v;
      break;
    }
  }

  const nameCells = qtyIdx !== -1 ? leading.filter((_, idx) => idx !== qtyIdx) : leading;
  const name = cleanDescription(nameCells.join(" "));
  if (!name) return null;

  const item: { name: string; quantity: number; cost?: number; vaPercent?: number } = {
    name,
    quantity: qtyIdx !== -1 ? qtyVal : 1,
    cost,
  };
  const vaPercent = parsePercent(last);
  if (vaPercent !== undefined) item.vaPercent = vaPercent;
  return item;
};

export function preprocessQuotedNewlines(text: string): string {
  const chars: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        chars.push('"');
        i++;
      } else {
        inQuotes = !inQuotes;
        chars.push(char);
      }
    } else if ((char === "\r" || char === "\n") && inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      chars.push(" ");
    } else {
      chars.push(char);
    }
  }
  return chars.join("");
}

const HEADER_UNIT_PATTERNS = [
  /^(qty|quantity|nos|nos\.|nos:|nos\.:|qty\.|qty:|\(nos\.\)|\(nos\)|pcs|units?|s\.?no\.?|sl\.?no\.?|sr\.?no\.?|description|item description|particulars?)$/i,
  /^qty\.:\s*\(nos\.\)$/i,
];

export function isHeaderOrUnitText(desc: string): boolean {
  const norm = desc.trim().toLowerCase();
  if (!norm) return true;
  return HEADER_UNIT_PATTERNS.some((pat) => pat.test(norm));
}

export function parseClipboardText(text: string): ParsedItem[] {
  const cleanText = preprocessQuotedNewlines(text);

  // Header-based parsing for tab-separated spreadsheet data
  const headerResult = tryParseHeaderCsv(cleanText);
  if (headerResult) return headerResult;

  const result: ParsedItem[] = [];
  let accumulatedDesc: string[] = [];

  const flushAccumulator = (qty: number) => {
    if (accumulatedDesc.length > 0) {
      const mergedName = cleanDescription(accumulatedDesc.join(" "));
      if (mergedName && !isHeaderOrUnitText(mergedName) && !isNaN(qty) && qty > 0) {
        result.push({ itemName: mergedName, quantity: qty });
      }
      accumulatedDesc = [];
    }
  };

  // Split text into lines
  const lines = cleanText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;

    // Case 1: Tab-separated (typically Excel/Sheets)
    if (rawLine.includes("\t")) {
      const cells = rawLine.split("\t").map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) {
        // Positional fallback: [Name, Qty, Cost, VA%]
        const trailing = tryParseTrailingCostVa(cells);
        if (trailing) {
          if (accumulatedDesc.length > 0) {
            flushAccumulator(1);
          }
          const item: ParsedItem = {
            itemName: trailing.name,
            quantity: trailing.quantity,
          };
          if (trailing.cost !== undefined) item.cost = trailing.cost;
          if (trailing.vaPercent !== undefined) item.vaPercent = trailing.vaPercent;
          if (!isHeaderOrUnitText(trailing.name)) {
            result.push(item);
          }
          continue;
        }

        // Find the last cell that is a valid number (from right to left)
        let qtyIdx = -1;
        let qtyVal = NaN;

        for (let j = cells.length - 1; j >= 0; j--) {
          const cleanVal = cells[j].replace(/,/g, "").trim();
          const val = parseFloat(cleanVal);
          if (!isNaN(val) && val > 0 && NUMERIC_PATTERN.test(cleanVal)) {
            qtyIdx = j;
            qtyVal = val;
            break;
          }
        }

        if (qtyIdx !== -1) {
          // If we had accumulated text before this spreadsheet row, flush it with default qty 1
          if (accumulatedDesc.length > 0) {
            flushAccumulator(1);
          }
          // The other cells form the item name
          const nameCells = cells.filter((_, idx) => idx !== qtyIdx);
          const name = cleanDescription(nameCells.join(" "));
          if (name && !isHeaderOrUnitText(name) && qtyVal > 0) {
            result.push({ itemName: name, quantity: qtyVal });
          }
        } else {
          // Treat as a regular description line
          accumulatedDesc.push(cells.join(" "));
        }
      }
      continue;
    }

    // Case 2: Purely numeric line (quantity on its own line after description)
    const cleanNum = trimmedLine.replace(/,/g, "").trim();
    const pureNum = parseFloat(cleanNum);
    if (!isNaN(pureNum) && pureNum > 0 && NUMERIC_PATTERN.test(cleanNum)) {
      if (accumulatedDesc.length > 0) {
        flushAccumulator(pureNum);
      }
      continue;
    }

    // Case 3: Line ends with a quantity (e.g. description followed by quantity)
    // Matches whitespace followed by digits (allowing commas and decimals) at the end of the line
    const match = trimmedLine.match(/(.*?)\s+(\d[\d,]*(?:\.\d+)?)$/);
    if (match) {
      const descPart = match[1].trim();
      const qtyPart = parseFloat(match[2].replace(/,/g, ""));
      if (!isNaN(qtyPart) && qtyPart > 0) {
        if (descPart) {
          accumulatedDesc.push(descPart);
        }
        flushAccumulator(qtyPart);
        continue;
      }
    } else {
      // Case 4: Wrapped description line with no quantity
      accumulatedDesc.push(trimmedLine);
    }
  }

  // Flush any leftover accumulated description with quantity 1
  if (accumulatedDesc.length > 0) {
    flushAccumulator(1);
  }

  return result;
}
