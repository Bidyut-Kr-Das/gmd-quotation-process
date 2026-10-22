/**
 * Canonical date parser for the GMD text date columns (ContractReview.dateOfContract,
 * SupplyHistory dates, GMD Updation dates, …).
 *
 * Those columns are Prisma `String?`, i.e. Postgres `text`, so the stored value is
 * whatever the sheet or a human typed. Historically three modules each carried their
 * own copy of this logic, which let them drift. All of them now delegate here.
 *
 * THE IMPORTANT RULE: a bare numeric string is never a date.
 * `new Date("45913")` is parsed by V8 as the YEAR 45913, not as an Excel serial. That
 * silently moved 12 ContractReview rows to the far future, so they vanished from every
 * date-filtered view instead of being reported as unparseable. Excel serials are
 * converted by scripts/normalise-contract-review-dates.ts, not guessed at here.
 */

/** The format the DatePicker commits and the display columns are expected to hold. */
export const CANONICAL_DATE = "dd-MMM-yyyy";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** A string that is only digits (optionally one decimal) is not a date. */
function isBareNumber(s: string): boolean {
  return /^\d+(\.\d+)?$/.test(s);
}

export function parseGmdDate(str: unknown): Date | null {
  if (typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;
  if (isBareNumber(s)) return null;

  // Primary: DD-Mmm-YY / DD-MMM-YYYY e.g. 12-Jan-24, 05-Feb-2023
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m[1], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      if (!isNaN(day) && day >= 1 && day <= 31 && !isNaN(year)) {
        return new Date(year, mon, day);
      }
    }
  }

  // Fallback: ISO / locale strings (e.g. 2024-01-12)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/**
 * Converts an Excel 1900-system serial number to a UTC date, or null when the input is
 * not a plausible serial. Used only by the normalisation backfill — never by the UI.
 */
export function excelSerialToDate(serial: number): Date | null {
  if (!isFinite(serial) || serial < 1 || serial > 2958465) return null; // 1 .. 9999-12-31
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
}
