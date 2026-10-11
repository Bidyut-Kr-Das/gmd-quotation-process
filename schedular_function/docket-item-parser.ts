/**
 * Pure item-line parser for docket mail content.
 *
 * Turns free-form email bodies, OCR text and attachment text into a list of
 * `{ itemName, quantity }` candidates for the `docket-creation` scheduled job.
 *
 * Deliberately free of Prisma / network / AI imports so it can be unit-tested
 * without a database. The optional AI fallback lives in
 * `docket-item-extraction.ts`.
 *
 * Design rules (see README `docket-creation`):
 *   - Only lines that carry an explicit quantity are emitted. A line with no
 *     quantity is skipped, per the product requirement.
 *   - The item name is the line with its enumerator, quantity token and trailing
 *     price column removed. The rest of the wording is preserved verbatim.
 *   - Header rows, totals, signatures and contact lines are dropped.
 *   - Identical `itemName` + `quantity` pairs are de-duplicated, which collapses
 *     the repeated blocks produced by quoted reply history.
 */

export interface ParsedDocketItem {
  itemName: string;
  quantity: number;
}

export interface DocketParserInput {
  /** Full message bodies (a thread body may contain several messages). */
  bodies?: (string | null | undefined)[];
  /** OCR text of attached PDFs/images. */
  ocrText?: string | null;
  /** Plain text extracted from attachments (spreadsheets are tab-delimited). */
  attachmentTexts?: (string | null | undefined)[];
  /** Safety cap on returned items. Default 500. */
  maxItems?: number;
}

const MAX_ITEMS_DEFAULT = 500;
const MAX_QUANTITY = 1_000_000;

/** Units that denote a countable quantity (not a size, pressure or mass). */
const QUANTITY_UNITS = [
  "nos", "no", "pcs", "pc", "pieces", "piece",
  "sets", "set", "each", "ea", "units", "unit",
  "numbers", "number", "pairs", "pair",
  "boxes", "box", "rolls", "roll", "coils", "coil", "bags", "bag",
  "mtrs", "mtr", "meters", "meter", "metres", "metre",
  "lengths", "length",
];

const UNIT_ALT = QUANTITY_UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const QTY_LABEL_RE = new RegExp(
  `\\b(?:req(?:d|uired)?\\s*qty|order\\s*qty|total\\s*qty|qty|quantity|qnty)\\s*[:=\\-.]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${UNIT_ALT})?\\b\\.?`,
  "i",
);
// A tight range ("2-3 Nos") — spaces around the dash are deliberately NOT
// accepted, so a size followed by a quantity ("DN100 - 4 Nos") is not mistaken
// for a range.
const RANGE_UNIT_RE = new RegExp(`(\\d[\\d,]*)[-\\u2013](\\d[\\d,]*)\\s*(?:${UNIT_ALT})\\b\\.?`, "i");
const TRAILING_UNIT_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${UNIT_ALT})\\b\\.?`, "i");
const LEADING_QTY_RE = new RegExp(`^\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:x\\b|${UNIT_ALT})\\b\\.?`, "i");

const ENUMERATOR_RE = /^\s*(?:\d+[.)]|[-*•–])\s+/;
const TRAILING_PRICE_RE = /\s+(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*$/i;
const TRAILING_SEP_RE = /[\s\-–:;,|]+$/;
const LEADING_OF_RE = /^of\s+/i;

/** Header / noise lines that must never become an item name. */
const SKIP_ITEM_RE = [
  /^(?:sl\.?\s*no|sr\.?\s*no|s\.?\s*no|ser(?:ial)?\.?\s*no|no\.?)$/i,
  /^(?:item|item\s*name|item\s*desc(?:ription)?|description|particulars|material|name|specification|spec)$/i,
  /^(?:qty|quantity|qnty|unit|uom|rate|price|amount|value|total|sub\s*-?\s*total|subtotal|grand\s*total|gst|igst|cgst|sgst|hsn|sac|make|brand|delivery|terms?|remarks?|note|page)\b/i,
  /^(?:regards?|thanks?|thank\s*you|best\s*regards|sincerely|dear|hi|hello|from|sent|to|cc|bcc|subject|tel|mobile|phone|email|e-mail|website|address|quotation|enquiry|inquiry|rfq|ref|reference|date|kind\s*attn)\b/i,
  // Prose / conversational lines are never item names.
  /^(?:as\s+discussed|we\s+(?:require|need|want)|kindly|please|refer|dear|hi\b|hello|thanks|thank\s+you|regards|message)\b/i,
];

/**
 * Whole lines that must be discarded before any quantity parsing. Email headers,
 * quoted-reply separators, serial-number fragments and pressure/spec lines all
 * otherwise masquerade as line items.
 */
const LINE_SKIP_RE = [
  /^\s*(?:subject|from|sent|date|to|cc|bcc|reply-to|return-path|importance)\s*:/i,
  /^on\s.+wrote:?\s*$/i,
  /^\s*[-_=]{3,}/,
  /^\s*(?:begin\s+forwarded|forwarded\s+message|original\s+message)/i,
  /\b(?:sr|sl)\.?\s*no\b/i,
  /\b(?:gst|hsn|sac|igst|cgst|sgst)\b/i,
  /\bpsig\b|\bkg\s*\/\s*cm2\b|\bkg\s*\/\s*cm\b/i,
];

/** Strips leading `>` / `|` quote markers so quoted history collapses on dedupe. */
function stripQuoteMarkers(line: string): string {
  return line.replace(/^\s*(?:[>|]+\s*)+/, "");
}

function shouldSkipLine(line: string): boolean {
  return LINE_SKIP_RE.some((re) => re.test(line));
}

/** A line that is clearly a header/noise line, not an item. */
function isNoiseItemName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;
  if (/^(?:https?:\/\/|www\.)/i.test(n)) return true;
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(n)) return true;
  if (SKIP_ITEM_RE.some((re) => re.test(n))) return true;
  // A line that is only a quantity unit or label ("Nos", "Qty", "Nos.") is noise.
  if (new RegExp(`^(?:${UNIT_ALT}|qty|quantity|qnty)\\.?$`, "i").test(n)) return true;
  // A line that is only digits/punctuation is never an item.
  if (!/[a-z]/i.test(n)) return true;
  return false;
}

/** Decodes the handful of HTML entities that show up in mail bodies. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Strips tags and entity-decodes, preserving line breaks and tabs. */
export function htmlToText(text: string): string {
  return decodeEntities(
    text
      .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<\/(?:td|th)>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  );
}

function parsePositiveNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const value = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_QUANTITY) return null;
  return value;
}

/**
 * Extracts a quantity from a line and returns the line with the quantity token
 * removed. Returns `null` when the line carries no explicit quantity.
 */
function extractQuantity(line: string): { quantity: number; cleaned: string } | null {
  let m = QTY_LABEL_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  m = RANGE_UNIT_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  m = LEADING_QTY_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  m = TRAILING_UNIT_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  return null;
}

/** Cleans a candidate line into an item name, or `null` if it is noise. */
function toItemName(line: string): string | null {
  const name = line
    .replace(ENUMERATOR_RE, "")
    .replace(TRAILING_PRICE_RE, "")
    .replace(/^[\s*:;.\-–—>|]+/, "")
    .replace(TRAILING_SEP_RE, "")
    .replace(/[\s*:;.\-–—|]+$/, "")
    .replace(LEADING_OF_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || isNoiseItemName(name)) return null;
  return name;
}

function dedupeKey(item: ParsedDocketItem): string {
  return `${item.itemName.toLowerCase().replace(/\s+/g, " ").trim()}|${item.quantity}`;
}

/**
 * Parses tab- or pipe-delimited table blocks (email tables and spreadsheets
 * flattened to text). Finds a header row with a description column and a
 * quantity column, then reads each following row.
 */
function parseDelimitedTables(lines: string[], out: ParsedDocketItem[]): void {
  let header: { desc: number; qty: number; size: number; fields: number } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const delimiter = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
    if (!delimiter) {
      header = null;
      continue;
    }

    const cells = line.split(delimiter).map((c) => c.trim());
    if (cells.length < 2) {
      header = null;
      continue;
    }

    const totalQtyIdx = cells.findIndex((c) => /^total\s*qty$/i.test(c));
    const qtyIdx = totalQtyIdx !== -1
      ? totalQtyIdx
      : cells.findIndex((c) => /^(?:qty|quantity|qnty|nos|no\.?|req(?:d|uired)?\s*qty)$/i.test(c));
    const descIdx = cells.findIndex((c) =>
      /^(?:item|item\s*name|item\s*desc(?:ription)?|description|particulars|material|name|specification)$/i.test(c),
    );
    const sizeIdx = cells.findIndex((c) =>
      /^(?:size|size\s*\/\s*dn|dn|nominal\s*size|dia|diameter)$/i.test(c),
    );

    if (qtyIdx !== -1 && descIdx !== -1) {
      header = { desc: descIdx, qty: qtyIdx, size: sizeIdx, fields: cells.length };
      continue;
    }

    if (header && cells.length === header.fields) {
      const quantity = parsePositiveNumber((cells[header.qty] ?? "").match(/\d[\d,]*(?:\.\d+)?/)?.[0]);
      if (quantity === null) continue;
      let itemName = toItemName(cells[header.desc] ?? "");
      if (!itemName) continue;
      // Fold an adjacent size column into the name when the description lacks it.
      if (header.size >= 0) {
        const sizeCell = (cells[header.size] ?? "").trim();
        if (sizeCell && !itemName.toLowerCase().includes(sizeCell.toLowerCase())) {
          itemName = `${itemName} ${sizeCell}`.replace(/\s+/g, " ").trim();
        }
      }
      out.push({ itemName, quantity });
    }
  }
}

/**
 * Parses every provided source into de-duplicated `{ itemName, quantity }`
 * candidates, in first-seen order. Never throws.
 *
 * The email body is parsed line-by-line **and** as tables. OCR text and
 * attachment text are parsed as **tables only**: free-form OCR fragments
 * (specs, inspection reports) otherwise masquerade as line items, while genuine
 * BOQ/spreadsheet tables are still captured.
 */
export function parseDocketItems(input: DocketParserInput): ParsedDocketItem[] {
  const maxItems = input.maxItems && input.maxItems > 0 ? input.maxItems : MAX_ITEMS_DEFAULT;

  const fullTexts: string[] = [];
  for (const body of input.bodies ?? []) if (body) fullTexts.push(body);
  const tableOnlyTexts: string[] = [];
  if (input.ocrText) tableOnlyTexts.push(input.ocrText);
  for (const text of input.attachmentTexts ?? []) if (text) tableOnlyTexts.push(text);

  const candidates: ParsedDocketItem[] = [];

  const safeHtml = (raw: string): string | null => {
    try {
      return htmlToText(String(raw));
    } catch {
      return null;
    }
  };

  // 1. Full sources: tables first, then line-by-line list detection.
  for (const raw of fullTexts) {
    const text = safeHtml(raw);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);

    parseDelimitedTables(lines, candidates);

    for (const rawLine of lines) {
      const line = stripQuoteMarkers(rawLine).trim();
      if (!line || line.length > 400) continue;
      if (shouldSkipLine(line)) continue;
      const qty = extractQuantity(line);
      if (!qty) continue;
      const itemName = toItemName(qty.cleaned);
      if (!itemName) continue;
      candidates.push({ itemName, quantity: qty.quantity });
    }
  }

  // 2. OCR + attachment text: tables only.
  for (const raw of tableOnlyTexts) {
    const text = safeHtml(raw);
    if (text === null) continue;
    parseDelimitedTables(text.split(/\r?\n/), candidates);
  }

  const seen = new Set<string>();
  const items: ParsedDocketItem[] = [];
  for (const item of candidates) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= maxItems) break;
  }

  return items;
}
