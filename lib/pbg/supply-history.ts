const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

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
 * Parses the date formats found in supply-history exports:
 *   dd-MMM-yy (11-Apr-24), dd-MMM-yyyy
 *   dd-MM-yyyy / dd.MM.yyyy (25-02-2022)
 *   dd/MM/yyyy
 *   yyyy-mm-dd
 */
export function parseFlexibleDate(value: unknown): Date | null {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!cleaned) return null;

  const raw = cleaned.replace(/[.]/g, "-");

  let m = raw.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    let year = +m[3];
    if (year < 100) year += 2000;
    return toUtcDate(year, month, +m[1]);
  }

  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    return toUtcDate(year, +m[2] - 1, +m[1]);
  }

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toUtcDate(+m[1], +m[2] - 1, +m[3]);

  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Keeps only the rows sharing the most recent date (all items on that date).
 * When no row has a parseable date, every row is returned untouched.
 */
export function pickLatestDateRows<T>(
  rows: T[],
  getDate: (row: T) => unknown,
): { latest: Date | null; latestRaw: string | null; rows: T[] } {
  const parsed = rows.map((row) => parseFlexibleDate(getDate(row)));

  let latest: Date | null = null;
  let latestIndex = -1;
  for (let i = 0; i < parsed.length; i += 1) {
    const date = parsed[i];
    if (date && (!latest || date > latest)) {
      latest = date;
      latestIndex = i;
    }
  }

  if (!latest || latestIndex === -1) {
    return { latest: null, latestRaw: null, rows };
  }

  const time = latest.getTime();
  const filtered = rows.filter((_, i) => parsed[i]?.getTime() === time);
  const raw = getDate(rows[latestIndex]);
  const latestRaw = raw === null || raw === undefined ? null : String(raw);

  return { latest, latestRaw, rows: filtered };
}

/** Normalizes a PO string for matching (trim, collapse spaces, uppercase). */
export function normalizePo(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
