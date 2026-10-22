export const IST_TZ = "Asia/Kolkata";

function ordinalSuffix(n: number): string {
  if (n > 3 && n < 21) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * Returns YYYY-MM-DD string for the given instant in IST.
 * Works regardless of browser local timezone.
 */
export function toISTDateKey(val: Date | string | number | null | undefined): string | null {
  if (val == null || val === "") return null;
  const d = val instanceof Date ? val : new Date(val as string | number);
  if (isNaN(d.getTime())) return null;
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Short format used in TenderTable: DD-MMM-YY (e.g. 25-Aug-25) in IST
 */
export function formatDateISTShort(val: Date | string | number | null | undefined): string {
  if (val == null || (typeof val === "string" && val.trim() === "")) return "-";
  const d = val instanceof Date ? val : new Date(val as string | number);
  if (isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${day}-${month}-${year}`;
}

/**
 * Long format used in OptimizedTenderTable / viewer: do MMM, yyyy (e.g. 25th Aug, 2025) in IST
 */
export function formatDateISTLong(val: Date | string | number | null | undefined): string {
  if (val == null || (typeof val === "string" && val.trim() === "")) return "-";
  const d = val instanceof Date ? val : new Date(val as string | number);
  if (isNaN(d.getTime())) return "-";
  const dayNum = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: IST_TZ,
      day: "numeric",
    }).format(d)
  );
  const monthShort = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    month: "short",
  }).format(d);
  const year = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    year: "numeric",
  }).format(d);
  return `${dayNum}${ordinalSuffix(dayNum)} ${monthShort}, ${year}`;
}

/**
 * Generic IST formatter – keeps backwards compatibility for callers that previously used local formatting.
 * Provide format option: "short" -> DD-MMM-YY, "long" -> do MMM, yyyy
 */
export function formatDateIST(
  val: Date | string | number | null | undefined,
  fmt: "short" | "long" = "short"
): string {
  return fmt === "long" ? formatDateISTLong(val) : formatDateISTShort(val);
}

/**
 * Returns true if the given date (instant) is before today in IST (calendar day).
 * Today is calculated in IST.
 */
export function isBeforeTodayIST(val: Date | string | number | null | undefined): boolean {
  if (val == null || val === "") return false;
  const dateKey = toISTDateKey(val);
  const todayKey = toISTDateKey(new Date());
  if (!dateKey || !todayKey) return false;
  return dateKey < todayKey;
}

export function isAfterTodayIST(val: Date | string | number | null | undefined): boolean {
  const dateKey = toISTDateKey(val);
  const todayKey = toISTDateKey(new Date());
  if (!dateKey || !todayKey) return false;
  return dateKey > todayKey;
}

/**
 * Check if IST date key of val is within [fromKey, toKey] inclusive (YYYY-MM-DD strings in IST or Date objects)
 */
export function isISTDateInRange(
  val: Date | string | number | null | undefined,
  from: string | Date | null | undefined,
  to: string | Date | null | undefined
): boolean {
  const key = toISTDateKey(val);
  if (!key) return false;
  const fromKey = from ? toISTDateKey(from) : null;
  const toKey = to ? toISTDateKey(to) : null;
  if (fromKey && key < fromKey) return false;
  if (toKey && key > toKey) return false;
  return true;
}

/**
 * Helper to convert a filter input (YYYY-MM-DD string or Date) to IST date key.
 * If input is already YYYY-MM-DD (from <input type="date">), treat it as IST date directly.
 */
export function normalizeFilterDateKey(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === "string") {
    // If already YYYY-MM-DD, assume IST date
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return input.trim();
  }
  return toISTDateKey(input);
}

// ---- IST week/month/year helpers for deadline presets ----
// These compute boundaries as YYYY-MM-DD strings in IST, regardless of local timezone.

function getISTPseudoDate(date: Date): Date {
  // Convert instant to pseudo date whose local components equal IST components
  return new Date(date.toLocaleString("en-US", { timeZone: IST_TZ }));
}

export function getISTWeekRange(date: Date = new Date()): { fromKey: string; toKey: string } {
  const pseudo = getISTPseudoDate(date);
  const day = pseudo.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(pseudo);
  monday.setDate(pseudo.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fromKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  const toKey = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
  return { fromKey, toKey };
}

export function getISTMonthRange(date: Date = new Date()): { fromKey: string; toKey: string } {
  const pseudo = getISTPseudoDate(date);
  const y = pseudo.getFullYear();
  const m = pseudo.getMonth(); // 0-11
  const fromKey = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const toKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fromKey, toKey };
}

export function getISTYearRange(date: Date = new Date()): { fromKey: string; toKey: string } {
  const pseudo = getISTPseudoDate(date);
  const y = pseudo.getFullYear();
  return { fromKey: `${y}-01-01`, toKey: `${y}-12-31` };
}

export function formatDateTimeIST(
  val: Date | string | number | null | undefined,
  pattern: "dd-MM-yyyy HH:mm" = "dd-MM-yyyy HH:mm"
): string {
  if (!val) return "";
  const d = val instanceof Date ? val : new Date(val as string | number);
  if (isNaN(d.getTime())) return "";
  // Use Intl for IST date/time parts
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  if (pattern === "dd-MM-yyyy HH:mm") return `${day}-${month}-${year} ${hour}:${minute}`;
  return `${day}-${month}-${year} ${hour}:${minute}`;
}
