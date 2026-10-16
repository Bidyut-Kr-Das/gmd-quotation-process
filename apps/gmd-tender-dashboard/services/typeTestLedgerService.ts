import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

const LEDGER_FILENAME = "Type Test Ledger.xlsx";
const TARGET_HEADERS = {
  erpCode: "erp code",
  issued: "issued",
  expire: "expire",
  testCertificateNo: "test certificate no",
  laboratory: "laboratory",
} as const;

export type TypeTestLab = "CPRI" | "ERDA" | "NABL";

export function mapLab(raw: string | null): TypeTestLab | null {
  if (!raw) return null;
  const n = raw.toLowerCase().trim();
  if (n.includes("central power research institute")) return "CPRI";
  if (n.includes("electrical research and development association")) return "ERDA";
  return "NABL";
}

export type TypeTestLedgerRow = {
  erpCode: string | null;
  itemCode: string | null;
  issued: string | null;
  issuedRaw: unknown;
  expiredRaw: unknown;
  expired: string | null;
  testCertificateNo: string | null;
  testCertificateHyperlink: string | null;
  laboratory: string | null;
  lab: TypeTestLab | null;
  rowNumber: number; // 1-indexed excel row
};

export type TypeTestLedgerResult = {
  filePath: string;
  sheetName: string;
  headerRowIndex: number;
  columns: Record<keyof typeof TARGET_HEADERS, number>;
  rows: TypeTestLedgerRow[];
  totalRows: number;
};

function getNetworkRoot(): string {
  const p = process.env.TYPE_TEST_FILES_PATH;
  if (!p) throw new Error("TYPE_TEST_FILES_PATH is not set");
  return path.resolve(p);
}

function findLedgerFile(root: string): string | null {
  const direct = path.join(root, LEDGER_FILENAME);
  if (fs.existsSync(direct)) return direct;

  // case-insensitive fallback at root
  try {
    const entries = fs.readdirSync(root);
    const found = entries.find((e) => e.toLowerCase() === LEDGER_FILENAME.toLowerCase());
    if (found) return path.join(root, found);
  } catch {
    return null;
  }

  // recursive search (depth limited)
  const queue: string[] = [root];
  let depth = 0;
  while (queue.length && depth < 12) {
    const dir = queue.shift()!;
    depth++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === LEDGER_FILENAME.toLowerCase()) return full;
      if (e.isDirectory()) queue.push(full);
    }
  }
  return null;
}

function normalizeHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function extractHyperlinkUrl(cell: XLSX.CellObject | undefined): string | null {
  if (!cell) return null;
  // xlsx stores hyperlink as cell.l.Target
  const l = (cell as unknown as { l?: { Target?: string } }).l;
  if (l?.Target) return String(l.Target).trim();
  // fallback: HYPERLINK formula =HYPERLINK("url","text")
  const f = (cell as unknown as { f?: string }).f;
  if (f) {
    const m = f.match(/HYPERLINK\s*\(\s*"(.*?)"\s*[,)]/i);
    if (m) return m[1];
    const m2 = f.match(/HYPERLINK\s*\(\s*'(.*?)'\s*[,)]/i);
    if (m2) return m2[1];
  }
  return null;
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function readTypeTestLedger(opts?: { filePath?: string }): Promise<TypeTestLedgerResult> {
  const root = getNetworkRoot();
  if (!fs.existsSync(root)) throw new Error(`TYPE_TEST_FILES_PATH does not exist: ${root}`);

  const ledgerPath = opts?.filePath ? path.resolve(opts.filePath) : findLedgerFile(root);
  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    throw new Error(`Ledger file "${LEDGER_FILENAME}" not found under ${root}`);
  }

  const workbook = XLSX.readFile(ledgerPath, { cellDates: true });
  if (!workbook.SheetNames.length) throw new Error(`No sheets in ${ledgerPath}`);

  // Try to find sheet that contains required headers
  let chosenSheetName: string | null = null;
  let chosenHeaderRow = -1;
  let chosenCols: Record<keyof typeof TARGET_HEADERS, number> | null = null;
  let chosenRows: unknown[][] = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
    if (!rows.length) continue;
    // scan first 20 rows for header
    for (let r = 0; r < Math.min(20, rows.length); r++) {
      const row = rows[r] as unknown[];
      if (!row) continue;
      const norm = row.map(normalizeHeader);
      const idx: Record<string, number> = {};
      norm.forEach((h, i) => {
        if (!h) return;
        // map exact normalized header
        for (const [key, target] of Object.entries(TARGET_HEADERS)) {
          if (h === target) idx[key] = i;
        }
      });
      // require at least testCertificateNo found, but prefer all 4
      const hasRequired = idx.testCertificateNo !== undefined && idx.erpCode !== undefined;
      const score = Object.keys(idx).length;
      if (hasRequired && score >= 2) {
        // accept this sheet
        if (score === 4 || !chosenCols || score > Object.keys(chosenCols).length) {
          chosenSheetName = name;
          chosenHeaderRow = r;
          chosenCols = idx as Record<keyof typeof TARGET_HEADERS, number>;
          chosenRows = rows;
          if (score === 4) break;
        }
      }
    }
    if (chosenCols && Object.keys(chosenCols).length === 4) break;
  }

  if (!chosenSheetName || chosenCols === null || chosenHeaderRow === -1) {
    // fallback to first sheet first row
    const fallbackSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[fallbackSheet];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
    const headers = (rows[0] as unknown[])?.map(normalizeHeader) ?? [];
    // build best-effort cols
    const cols: Record<string, number> = {};
    headers.forEach((h, i) => {
      for (const [key, target] of Object.entries(TARGET_HEADERS)) {
        if (h === target) cols[key] = i;
      }
    });
    throw new Error(
      `Could not detect required headers in any sheet. Tried ${workbook.SheetNames.join(", ")}. First row headers: ${JSON.stringify(headers)}`
    );
  }

  const sheet = workbook.Sheets[chosenSheetName];
  const cols = chosenCols as Record<keyof typeof TARGET_HEADERS, number>;

  const result: TypeTestLedgerRow[] = [];
  for (let r = chosenHeaderRow + 1; r < chosenRows.length; r++) {
    const row = chosenRows[r] as unknown[];
    if (!row || row.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;

    const erpRaw = cols.erpCode !== undefined ? row[cols.erpCode] : null;
    const issuedRaw = cols.issued !== undefined ? row[cols.issued] : null;
    const expiredRaw = (cols as Record<string, number>).expire !== undefined ? row[(cols as Record<string, number>).expire] : null;
    const certRaw = cols.testCertificateNo !== undefined ? row[cols.testCertificateNo] : null;
    const labRaw = cols.laboratory !== undefined ? row[cols.laboratory] : null;

    // hyperlink from actual cell object, not sheet_to_json value
    let certHyperlink: string | null = null;
    if (cols.testCertificateNo !== undefined) {
      const addr = XLSX.utils.encode_cell({ r, c: cols.testCertificateNo });
      // note: r is index in sheet_to_json rows which equals excel row index if no blank rows skipped,
      // but blankrows:false may offset; safer to use headerRow + data offset
      // We use raw sheet cell lookup: headerRow (excel 0-index) + (r - headerRow)
      // Since sheet_to_json with header:1 maps excel rows 1:1 minus blankrows, we need to map correctly.
      // Safer: use r from sheet_to_json loop as excel row number = r+1 (since header:1 is 0-indexed)
      // So we re-encode with r as excel row
      const excelAddr = XLSX.utils.encode_cell({ r, c: cols.testCertificateNo });
      const cell = sheet[excelAddr] as XLSX.CellObject | undefined;
      certHyperlink = extractHyperlinkUrl(cell);
    }

    // Issued/Expire may be Date object if cellDates:true
    let issuedStr: string | null = null;
    if (issuedRaw instanceof Date) issuedStr = issuedRaw.toISOString();
    else issuedStr = cellToString(issuedRaw);
    let expiredStr: string | null = null;
    if (expiredRaw instanceof Date) expiredStr = expiredRaw.toISOString();
    else expiredStr = cellToString(expiredRaw);

    const erpCodeStr = cellToString(erpRaw);
    const labStr = cellToString(labRaw);
    result.push({
      erpCode: erpCodeStr,
      itemCode: erpCodeStr,
      issued: issuedStr,
      issuedRaw,
      expiredRaw,
      expired: expiredStr,
      testCertificateNo: cellToString(certRaw),
      testCertificateHyperlink: certHyperlink,
      laboratory: labStr,
      lab: mapLab(labStr),
      rowNumber: r + 1, // 1-indexed
    });
  }

  return {
    filePath: ledgerPath,
    sheetName: chosenSheetName,
    headerRowIndex: chosenHeaderRow,
    columns: cols,
    rows: result,
    totalRows: chosenRows.length,
  };
}

// Mapping for future tenderfiles save (type prefix for encryptRelativePath)
// Keep here so controller can reuse: when saving type test certs, use TYPE_TEST | relative path
export const TYPE_TEST_FILE_TYPE = "TYPETEST" as const;
export const TENDER_TYPE_TEST_TAG = "typeTestCertificate" as const;
