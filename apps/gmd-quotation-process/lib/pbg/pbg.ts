export type PbgRow = {
  clientName: string | null;
  project: string | null;
  poNumber: string | null;
  poDate: Date | null;
  bgNo: string | null;
  bgDate: Date | null;
  bgAmtFc: number | null;
  expiryDate: Date | null;
  claimDate: Date | null;
  marginPct: number | null;
  marginAmount: number | null;
  contactPerson: string | null;
  contactNumber: string | null;
  remark: string | null;
  status: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toText(value: unknown): string | null {
  const v = clean(value);
  return v === "" ? null : v;
}

function toUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Parses the date formats found in the sheet:
 *   dd-MM-yyyy  (13-06-2025)
 *   d-MMM-yy    (6-Feb-26, 15-Sep-25)
 *   dd/MM/yyyy  (14/12/2017)
 *   yyyy-mm-dd  (2025-06-13)
 */
export function parseDate(value: unknown): Date | null {
  const raw = clean(value).replace(/[.]/g, "-");
  if (!raw) return null;

  let m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return toUtcDate(+m[3], +m[2] - 1, +m[1]);

  m = raw.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    let year = +m[3];
    if (year < 100) year += 2000;
    return toUtcDate(year, month, +m[1]);
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    return toUtcDate(year, +m[2] - 1, +m[1]);
  }

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toUtcDate(+m[1], +m[2] - 1, +m[3]);

  return null;
}

/**
 * Parses amounts like "71,024.00", " 3,551.20 ", "5" into a number.
 */
export function parseNumber(value: unknown): number | null {
  const raw = clean(value).replace(/[^0-9.\-]/g, "");
  if (!raw || raw === "-" || raw === "." || raw === "-.") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sheet header -> PbgRow field. Keys are canonical header names (uppercased
 * with all non-alphanumerics stripped) so " BG Amt(FC) ", "BG_AMT" and
 * "Margin %" all resolve regardless of spacing/punctuation. Unlisted columns
 * are ignored. Legacy aliases are kept for backward compatibility.
 */
const HEADER_FIELDS: Record<string, keyof PbgRow> = {
  CLIENTNAME: "clientName",
  BENEFICIARYNAME: "clientName",
  PROJECT: "project",
  PONUMBER: "poNumber",
  PODATE: "poDate",
  BGNO: "bgNo",
  BGDATE: "bgDate",
  BGAMTFC: "bgAmtFc",
  BGAMT: "bgAmtFc",
  EXPIRYDATE: "expiryDate",
  CLAIMDATE: "claimDate",
  MARGIN: "marginPct",
  MARGINPCT: "marginPct",
  MARGINAMOUNT: "marginAmount",
  MARGINAMT: "marginAmount",
  CONTACTPERSON: "contactPerson",
  CONTACTNUMBER: "contactNumber",
  REMARK: "remark",
  STATUS: "status",
  CANCELLEDSTATUS: "status",
};

function normalizeHeader(value: unknown): string {
  return clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i += 1) {
    const headers = rows[i].map(normalizeHeader);
    if (
      headers.includes("BGNO") &&
      (headers.includes("CLIENTNAME") ||
        headers.includes("BENEFICIARYNAME") ||
        headers.includes("PONUMBER"))
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Maps sheet rows into typed PBG rows using the header names, so column order
 * and extra columns don't matter. Fields absent from the sheet stay null.
 * Returns the mapped rows plus the count of blank/header rows skipped.
 */
export function mapRows(rows: string[][]): {
  data: PbgRow[];
  skipped: number;
} {
  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex === -1) return { data: [], skipped: rows.length };

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexByField = new Map<keyof PbgRow, number>();
  headers.forEach((header, index) => {
    const field = HEADER_FIELDS[header];
    if (field !== undefined && !indexByField.has(field)) {
      indexByField.set(field, index);
    }
  });

  const data: PbgRow[] = [];
  let skipped = 0;

  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const cells = rows[r] ?? [];
    if (cells.every((cell) => clean(cell) === "")) {
      skipped += 1;
      continue;
    }

    const first = normalizeHeader(cells[0]);
    if (
      first === "SERIESNAME" ||
      first === "BENEFICIARYNAME" ||
      first === "CLIENTNAME"
    ) {
      skipped += 1;
      continue;
    }

    const cell = (field: keyof PbgRow): string => {
      const index = indexByField.get(field);
      return index === undefined ? "" : (cells[index] ?? "");
    };

    const row: PbgRow = {
      clientName: toText(cell("clientName")),
      project: toText(cell("project")),
      poNumber: toText(cell("poNumber")),
      poDate: parseDate(cell("poDate")),
      bgNo: toText(cell("bgNo")),
      bgDate: parseDate(cell("bgDate")),
      bgAmtFc: parseNumber(cell("bgAmtFc")),
      expiryDate: parseDate(cell("expiryDate")),
      claimDate: parseDate(cell("claimDate")),
      marginPct: parseNumber(cell("marginPct")),
      marginAmount: parseNumber(cell("marginAmount")),
      contactPerson: toText(cell("contactPerson")),
      contactNumber: toText(cell("contactNumber")),
      remark: toText(cell("remark")),
      status: toText(cell("status")),
    };

    if (!row.bgNo && !row.poNumber && !row.clientName) {
      skipped += 1;
      continue;
    }

    data.push(row);
  }

  return { data, skipped };
}
