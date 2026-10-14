/**
 * Validity duration parsing + date math for the PBG "Validity On for Contract"
 * column and its derived "Extended Validity" column.
 *
 * Accepted values are number+unit pairs, e.g. "5y", "18m", "90d", or a
 * combination like "8y 18m". A bare number is treated as years.
 */

export type Duration = { months: number; days: number };

/** Dropdown suggestions for the Validity On column: years 1-5, months 1-11. */
export const VALIDITY_OPTIONS: string[] = [
  ...Array.from({ length: 5 }, (_, i) => `${i + 1}y`),
  ...Array.from({ length: 11 }, (_, i) => `${i + 1}m`),
];

const UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(years?|yrs?|months?|mos?|days?|y|m|d)(?![a-z])/g;

function toNumber(value: string): number {
  return Number(value.replace(",", "."));
}

/**
 * Parses a validity string into months + days. Returns null when nothing
 * usable is found or the value resolves to zero.
 */
export function parseDuration(input: string | null | undefined): Duration | null {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;

  let months = 0;
  let days = 0;
  let matched = false;
  UNIT_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = UNIT_RE.exec(raw)) !== null) {
    matched = true;
    const value = toNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = m[2][0];
    if (unit === "y") months += value * 12;
    else if (unit === "m") months += value;
    else days += value;
  }

  if (!matched) {
    const bare = toNumber(raw);
    if (!Number.isFinite(bare)) return null;
    months = bare * 12;
  }

  months = Math.round(months);
  days = Math.round(days);
  if (months === 0 && days === 0) return null;
  return { months, days };
}

/**
 * Adds a duration to an ISO (yyyy-mm-dd) date, clamping the day to the target
 * month's length (e.g. 2024-01-31 + 1m -> 2024-02-29).
 */
export function addDuration(isoDate: string, duration: Duration): string | null {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const totalMonths = month + duration.months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  const result = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  result.setUTCDate(result.getUTCDate() + duration.days);
  return result.toISOString().slice(0, 10);
}

/**
 * Extended Validity = Last Supply Date + Validity On duration. Null when either
 * input is missing or the duration cannot be parsed.
 */
export function computeExtendedValidity(
  validityOn: string | null | undefined,
  lastSupplyDate: string | null | undefined,
): string | null {
  if (!lastSupplyDate) return null;
  const duration = parseDuration(validityOn);
  if (!duration) return null;
  return addDuration(lastSupplyDate, duration);
}
