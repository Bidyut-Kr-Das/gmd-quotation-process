/**
 * Shared sentinel values used by contract-review flow-tree filters to express
 * "cell has a value" / "cell has no value" beyond plain exact matching.
 *
 * Cells are the joined display strings of `String[]` DB columns (e.g. the
 * OFFER NUMBER column renders as `"ID24Y-55"` or `"ID25Y-75, ID25Y-74"` or
 * `"0"`). A literal `"0"` is a data-entry placeholder for "none", so a cell
 * "has value" only when at least one comma-separated part is a real (non-0)
 * value.
 */
export const FLOW_HAS_VALUE = "(Has Value)";
export const FLOW_NO_VALUE = "(No Value)";
export const FLOW_ZERO = "(Zero)";
export const FLOW_NON_ZERO = "(Non-Zero)";

/** True when the cell contains at least one real (non-0, non-blank) part. */
export function cellHasValue(cell: string): boolean {
  if (!cell) return false;
  return cell.split(",").some((p) => p.trim() !== "" && p.trim() !== "0");
}

/**
 * True when the cell parses to the number 0 (mirrors page.tsx `isZeroBal`:
 * trims, strips surrounding quotes, drops thousands separators). Blank and
 * non-numeric cells return false, so blanks count as "non-zero" (Pending).
 */
export function cellIsZero(cell: string): boolean {
  let s = String(cell ?? "").trim();
  if (!s) return false;
  s = s.replace(/^["']+|["']+$/g, "").trim();
  const n = parseFloat(s.replace(/,/g, ""));
  return !isNaN(n) && n === 0;
}