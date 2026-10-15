/**
 * Physical Stock value derivation.
 *
 * `item_wise_value` is defined by the business as `rate/unit * available qty`,
 * rendered with two decimals. Stored numbers in the table arrive from the sheet
 * as formatted strings (e.g. "50,000.00"), so parsing strips thousands
 * separators. A blank/missing operand counts as 0.
 */
function parseAmount(value: unknown): number {
  const s = String(value ?? "").replace(/,/g, "").trim();
  if (s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** `rate/unit * available qty`, fixed to two decimals (e.g. "50000.00"). */
export function computeItemWiseValue(
  rateUnit: unknown,
  availableQty: unknown,
): string {
  return (parseAmount(rateUnit) * parseAmount(availableQty)).toFixed(2);
}
