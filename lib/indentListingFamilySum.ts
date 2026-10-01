// Indent Listing display transform for the SLV valve family.
//
// `SLV` and `TPAV+SLV` are separate base items, so they land on separate rows
// even when they describe the same valve family at the same size/PN/MC status.
// Operations wants both rows to carry the family's combined balance: the same
// Total (BAL BILL AG CONT) and the same per-variant V1..V4 split.
//
// Rows stay separate. Only the numeric cells (total + V1..V4) are summed across
// the pair; each row keeps its own category text and RM codes, and any row
// without a partner is returned untouched.

const ITEM_IDX = 0;
const SIZE_IDX = 1;
const PN_IDX = 2;
const MC_IDX = 3;
const TOTAL_IDX = 4;
const V_IDXS = [5, 6, 7, 8];

const SLV_ITEM = "SLV";
const TPAV_SLV_ITEM = "TPAV+SLV";

function normalizePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseNum(value: unknown): number {
  let s = String(value ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/^["']+|["']+$/g, "").replace(/,/g, "");
  return parseFloat(s);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Sum two numeric cells. A blank/non-numeric side counts as 0; when both are
// blank the original (blank) value is preserved so the cell still reads "—".
function sumAmount(a: unknown, b: unknown): unknown {
  const an = parseNum(a);
  const bn = parseNum(b);
  const aValid = !Number.isNaN(an);
  const bValid = !Number.isNaN(bn);
  if (!aValid && !bValid) return a ?? null;
  return String(round2((aValid ? an : 0) + (bValid ? bn : 0)));
}

/**
 * Pair every SLV row with the TPAV+SLV row sharing the same
 * SIZE + PN RATING + MC RECEIVED/PENDING and copy the summed Total and V1..V4
 * into both. Returns a new array in the original row order.
 */
export function applySlvFamilySums(rows: unknown[][]): unknown[][] {
  const slvByKey = new Map<string, number>();
  const tpavByKey = new Map<string, number>();

  rows.forEach((row, index) => {
    const item = normalizePart(row[ITEM_IDX]);
    if (item !== SLV_ITEM && item !== TPAV_SLV_ITEM) return;
    const key = [
      normalizePart(row[SIZE_IDX]),
      normalizePart(row[PN_IDX]),
      normalizePart(row[MC_IDX]),
    ].join("||");
    if (item === SLV_ITEM) {
      slvByKey.set(key, index);
    } else {
      tpavByKey.set(key, index);
    }
  });

  const combined = new Map<number, unknown[]>();

  for (const [key, slvIdx] of slvByKey) {
    const tpavIdx = tpavByKey.get(key);
    if (tpavIdx === undefined) continue;

    const slvRow = rows[slvIdx];
    const tpavRow = rows[tpavIdx];

    // Copy the base row so its categories and RM codes survive; only the total
    // and the variant amounts are replaced with the family sums.
    const withFamilySums = (base: unknown[], other: unknown[]): unknown[] => {
      const next = [...base];
      next[TOTAL_IDX] = sumAmount(base[TOTAL_IDX], other[TOTAL_IDX]);
      for (const vIdx of V_IDXS) {
        next[vIdx] = sumAmount(base[vIdx], other[vIdx]);
      }
      return next;
    };

    combined.set(slvIdx, withFamilySums(slvRow, tpavRow));
    combined.set(tpavIdx, withFamilySums(tpavRow, slvRow));
  }

  if (combined.size === 0) return rows;
  return rows.map((row, index) => combined.get(index) ?? row);
}
