export function isNullishString(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === "" || s === "-" || s === "--" || s.toLowerCase() === "null";
}

export function parsePrice(raw: unknown): number | null {
  if (isNullishString(raw)) return null;
  const original = String(raw).trim();
  const cleaned = original
    .replace(/[\u00A0]/g, " ")
    .replace(/[₹$€£,\s]/g, "")
    .replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") return null;
  const num = parseFloat(cleaned);
  if (isNaN(num) || !isFinite(num)) return null;
  return num;
}

/**
 * Calculate diff as decimal fraction ((our - l)/l).
 * Returns null if either missing, unparseable, or l === 0.
 * Rounded to 6 decimals to match diffPercentFromL1/L2 storage.
 */
export function calcDiffDecimal(ourValueRaw: unknown, lValueRaw: unknown): number | null {
  const our = parsePrice(ourValueRaw);
  const l = parsePrice(lValueRaw);
  if (our === null || l === null) return null;
  if (l === 0) return null;
  const pct = (our - l) / l;
  return parseFloat(pct.toFixed(6));
}

export function calcDiffString(ourValueRaw: unknown, lValueRaw: unknown): string | null {
  const dec = calcDiffDecimal(ourValueRaw, lValueRaw);
  if (dec === null) return null;
  return (dec * 100).toFixed(2) + "%";
}
