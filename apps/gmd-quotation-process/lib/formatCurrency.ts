const formatterCache = new Map<number, Intl.NumberFormat>();

function getIndianNumberFormatter(minimumFractionDigits: number): Intl.NumberFormat {
  let formatter = formatterCache.get(minimumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits,
      maximumFractionDigits: Math.max(2, minimumFractionDigits),
    });
    formatterCache.set(minimumFractionDigits, formatter);
  }
  return formatter;
}

/**
 * Format a numeric value using Indian digit grouping (thousands/lakhs/crores),
 * e.g. 1234567 -> "12,34,567" and 1234.5 -> "1,234.5".
 * Returns "" for blank / non-numeric input so callers can keep their "-" fallback.
 *
 * Pass minimumFractionDigits (e.g. 2) for totals that should always show decimals.
 */
export function formatIndianNumber(
  value: number | string | null | undefined,
  minimumFractionDigits = 0
): string {
  if (value === null || value === undefined || value === "") return "";
  const n =
    typeof value === "number"
      ? value
      : parseFloat(String(value).replace(/,/g, "").trim());
  if (Number.isNaN(n)) return "";
  return getIndianNumberFormatter(minimumFractionDigits).format(n);
}

/**
 * Strip grouping symbols from a user-entered value so it can be parsed as a number.
 */
export function cleanNumberInput(value: string): string {
  return value.replace(/[,\s₹]/g, "").trim();
}

/**
 * Compare a cleaned user-entered value against the raw stored value numerically.
 * Avoids spurious saves when formatting differences (e.g. "1230.00" vs "1,230") are
 * the only change.
 */
export function hasNumberChanged(
  entered: string,
  raw: number | string | null | undefined
): boolean {
  const next = parseFloat(entered);
  if (raw === null || raw === undefined || raw === "") {
    return !Number.isNaN(next);
  }
  const prev = parseFloat(String(raw).replace(/,/g, "").trim());
  if (Number.isNaN(prev) && Number.isNaN(next)) return false;
  if (Number.isNaN(prev) || Number.isNaN(next)) return true;
  return prev !== next;
}
