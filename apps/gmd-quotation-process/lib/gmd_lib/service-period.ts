/**
 * "service period complete" formatter for the Supply History dashboard.
 *
 * The MASTER sheet stores this column as a decimal number of YEARS (e.g. 2.5).
 * The dashboard needs it as a human "Years Months Days" string. When the sheet
 * cell is blank the duration is derived from the row's `Date` column up to the
 * current date.
 *
 * The formatted value is what gets PERSISTED to
 * `SupplyHistoryItem.servicePeriodComplete`, so this runs inside the shared
 * `mapSheetRowToDb` mapper (manual sync + scheduler) and in the one-off backfill.
 */
import { intervalToDuration } from "date-fns";
import { parseGmdDate } from "./dateParse";

/** Average Gregorian month length (365.2425 days / 12). */
const AVG_MONTH_DAYS = 365.2425 / 12;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** `2 Years 6 Months 12 Days` — zero-valued units are omitted, `0` -> `0 Days`. */
export function formatYmd(years: number, months: number, days: number): string {
  const parts: string[] = [];
  if (years > 0) parts.push(plural(years, "Year"));
  if (months > 0) parts.push(plural(months, "Month"));
  if (days > 0 || parts.length === 0) parts.push(plural(days, "Day"));
  return parts.join(" ");
}

/** Months-first breakdown of a decimal-year count (total months = years * 12). */
export function formatDecimalYearsToYmd(value: number): string {
  const totalMonths = value * 12;
  const years = Math.floor(totalMonths / 12);
  const remMonths = totalMonths - years * 12;
  const months = Math.floor(remMonths);
  const days = Math.round((remMonths - months) * AVG_MONTH_DAYS);
  return formatYmd(years, months, days);
}

const BLANK_SENTINELS = new Set(["-", "--", "—", "–"]);

function isBlank(value: string | null | undefined): boolean {
  if (value == null) return true;
  const t = value.trim();
  return t === "" || BLANK_SENTINELS.has(t);
}

/**
 * Resolve the display/persist value for "service period complete".
 *
 *  - numeric (e.g. "2.5")      -> decimal years converted to Y/M/D
 *  - blank                    -> `Date` -> now (intervalToDuration)
 *  - already formatted / text -> returned unchanged (never clobbered)
 *  - unusable (blank date)    -> null
 */
export function computeServicePeriodComplete(
  rawValue: string | null | undefined,
  dateValue: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (rawValue != null && !isBlank(rawValue)) {
    const trimmed = rawValue.trim();
    // Bare numeric string only (never "2 Years", never a date).
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) {
        return n < 0 ? null : formatDecimalYearsToYmd(n);
      }
    }
    // Already text (e.g. "5 Years"); keep as authored.
    return trimmed;
  }

  // Blank -> derive from the Date column to the current date.
  if (dateValue == null || isBlank(dateValue)) return null;
  const start = parseGmdDate(dateValue);
  if (!start) return null;
  const end = now.getTime() >= start.getTime() ? now : start;
  const d = intervalToDuration({ start, end });
  return formatYmd(d.years ?? 0, d.months ?? 0, d.days ?? 0);
}
