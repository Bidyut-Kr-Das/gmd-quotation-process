/**
 * Docket-number allocation. The fiscal year runs April (month index 3) to March,
 * and serials restart at 1 each year. Pure helpers so they can be unit-tested and
 * shared between the dashboard page and the pending-docket materializer.
 */

export function getFiscalYearLabel(date: Date): string {
  const month = date.getMonth(); // 0-indexed; April is 3
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYearStr = String(startYear + 1).slice(-2);
  return `${startYear}-${endYearStr}`;
}

/** e.g. "GMD/2026-27/". */
export function getFiscalPrefix(date: Date = new Date()): string {
  return `GMD/${getFiscalYearLabel(date)}/`;
}

/** Numeric serial from a docket number such as "GMD/2026-27/428" -> 428. */
export function parseDocketSerial(docketNumber: string): number {
  const parts = String(docketNumber ?? "").split("/");
  return parseInt(parts[parts.length - 1], 10) || 0;
}

/**
 * Allocates `count` sequential docket numbers after the highest serial already
 * present in the fiscal year. Callers must pass the existing docket numbers that
 * start with the current fiscal prefix.
 */
export function nextDocketSerials(
  existingDockets: string[],
  count: number,
  date: Date = new Date(),
): string[] {
  const prefix = getFiscalPrefix(date);
  const maxSerial = existingDockets.length
    ? Math.max(...existingDockets.map(parseDocketSerial))
    : 0;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${prefix}${maxSerial + i}`);
  return out;
}
