import { parse } from "date-fns";

const DATE_FORMATS = [
  // dash, AM/PM
  "d-M-yyyy-hh:mm a",
  "d-M-yyyy-hh:mm:ss a",
  // slash, AM/PM
  "d/M/yyyy-hh:mm a",
  "d/M/yyyy-hh:mm:ss a",
  // space, AM/PM
  "d-M-yyyy hh:mm a",
  "d-M-yyyy hh:mm:ss a",
  "d/M/yyyy hh:mm a",
  "d/M/yyyy hh:mm:ss a",
  // dash, 24h
  "d-M-yyyy-HH:mm",
  "d-M-yyyy-HH:mm:ss",
  // slash, 24h
  "d/M/yyyy-HH:mm",
  "d/M/yyyy-HH:mm:ss",
  // space, 24h
  "d-M-yyyy HH:mm",
  "d-M-yyyy HH:mm:ss",
  "d/M/yyyy HH:mm",
  "d/M/yyyy HH:mm:ss",
  // dot
  "d.M.yyyy-hh:mm a",
  "d.M.yyyy-HH:mm",
  "d.M.yyyy",
  // date-only
  "d-M-yyyy",
  "d/M/yyyy",
  // month name, dash
  "d-MMM-yyyy-hh:mm a",
  "d-MMM-yyyy-HH:mm",
  "d-MMM-yyyy",
  "d-MMM-yy",
  // month name, space
  "d MMM yyyy h:mm a",
  "d MMM yyyy HH:mm",
  "d MMM yyyy",
  "d MMM yy",
  "d MMMM yyyy",
  // month first
  "MMM d, yyyy",
  "MMMM d, yyyy",
  // ISO
  "yyyy-MM-dd",
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ssXXX",
  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
];

function sanitizeDateString(str: string): string {
  return str
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[–—‐]/g, "-")
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\b([ap])\.m\.?/gi, (_m, c: string) => c.toLowerCase() + "m")
    .trim();
}

function pivotTwoDigitYear(date: Date): Date {
  if (date.getFullYear() >= 100) return date;
  const year = date.getFullYear();
  date.setFullYear(year >= 70 ? 1900 + year : 2000 + year);
  return date;
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000; // 19800000

function toISTMidnightFromLocal(localDate: Date): Date {
  const y = localDate.getFullYear();
  const m = localDate.getMonth();
  const d = localDate.getDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

function toISTMidnightFromUTC(utcDate: Date): Date {
  const y = utcDate.getUTCFullYear();
  const m = utcDate.getUTCMonth();
  const d = utcDate.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

function isDateOnlyString(str: string): boolean {
  return !str.includes(":") && !/[ap]m/i.test(str);
}

export function parseDate(value: unknown): Date | null {
  if (value == null) return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    // Snap 18:29:50 drift to 18:30:00
    if (
      value.getUTCHours() === 18 &&
      value.getUTCMinutes() === 29 &&
      value.getUTCSeconds() === 50
    ) {
      const y = value.getUTCFullYear();
      const m = value.getUTCMonth();
      const d = value.getUTCDate();
      return new Date(Date.UTC(y, m, d, 18, 30, 0, 0));
    }
    // Date-only (midnight) → store as IST midnight
    if (
      value.getHours() === 0 &&
      value.getMinutes() === 0 &&
      value.getSeconds() === 0 &&
      value.getMilliseconds() === 0
    ) {
      return toISTMidnightFromLocal(value);
    }
    return value;
  }

  if (typeof value === "number") {
    const intPart = Math.round(value);
    const isDateOnly = Math.abs(value - intPart) < 0.00012; // ~10 sec tolerance
    if (isDateOnly) {
      const utcMidnight = new Date(Math.round((intPart - 25569) * 86400 * 1000));
      if (!isNaN(utcMidnight.getTime())) return toISTMidnightFromUTC(utcMidnight);
    }
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date;
  }

  const str = sanitizeDateString(String(value));
  if (!str || str === "N/A" || str === "-") return null;

  const reference = new Date();

  for (const fmt of DATE_FORMATS) {
    try {
      const parsed = parse(str, fmt, reference);
      if (!isNaN(parsed.getTime())) {
        const fixed = pivotTwoDigitYear(parsed);
        if (isDateOnlyString(str)) return toISTMidnightFromLocal(fixed);
        return fixed;
      }
    } catch {
      continue;
    }
  }

  const native = /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(str) ? new Date(str) : new Date(NaN);
  if (!isNaN(native.getTime())) {
    const fixed = pivotTwoDigitYear(native);
    if (isDateOnlyString(str)) return toISTMidnightFromLocal(fixed);
    return fixed;
  }

  return null;
}
