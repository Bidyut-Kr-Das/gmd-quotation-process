/**
 * Pure merge helpers for the INSPECTION OFFER DUMP sync
 * (`scripts/sync-ic-dump.ts`).
 *
 * Kept out of the script so the normalisation and union rules can be unit
 * tested without a Google Sheet or a database, and so the same logic can be
 * reused verbatim when this becomes a scheduled job. Same shape and intent as
 * `planStockWrites` / `planCBatchMarks` / `planContractPhysicalStock`.
 */

/** Join-key normalisation: trim, collapse internal whitespace, upper-case. */
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Header normalisation, matching the convention used across the sheet readers:
 * lower-case, collapse whitespace, strip everything that is not a-z0-9.
 */
export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Comparison key for a stored VALUE.
 *
 * Normalised so `id22y-18` and `ID22Y-18` are treated as the same value. Used
 * only for dedupe — a value is always STORED with the casing it arrived in, so
 * an existing DB entry is never rewritten just to change its case.
 */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Comma-split a sheet cell into distinct values.
 *
 * Blanks are dropped and duplicates removed case/whitespace-insensitively,
 * keeping the first spelling seen.
 */
export function splitCell(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(",")) {
    const v = part.trim();
    if (v === "") continue;
    const k = normalizeValue(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Union of `existing` and `incoming` that never shrinks.
 *
 * `existing` keeps its order and casing; an `incoming` value is appended only
 * when no equivalent value is already present, compared after `normalizeValue`.
 * Existing values are never removed and never rewritten.
 *
 * Because a blank cell yields no values, a blank can never clear a stored value
 * — that property falls out of the union rather than needing a separate guard.
 */
export function mergeUnion(existing: string[], incoming: string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing.map(normalizeValue));
  for (const v of incoming) {
    const k = normalizeValue(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** How many values `mergeUnion` appended. Zero means nothing changed. */
export function countAdded(existing: string[], merged: string[]): number {
  return merged.length - existing.length;
}