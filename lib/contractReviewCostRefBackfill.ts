import { normalizeContractKey } from "./gmd_lib/contract-review-enquiry-backfill";
import { parseGmdDate } from "./gmd_lib/dateParse";

/**
 * Gap-fills `EnquiryItem.costRefCode` from `ContractReview.costCodeRef`, which
 * is itself derived from the Indent Listing RM codes.
 *
 * The join is on item code: `ContractReview.itemCode` <-> `EnquiryItem.erpItemCode`.
 * Both sides are run through `normalizeContractKey` (trim, collapse whitespace,
 * upper) and the caller filters the Prisma query with `mode: "insensitive"`, so
 * a code stored as `rsd120003` on one side still matches `RSD120003` on the
 * other. The rate lookup in `fetchContractReviewRatesAction` deliberately keeps
 * its own raw, case-sensitive matching and is not affected by this.
 *
 * This only ever fills a BLANK cell. `costRefCode` is user-entered and required
 * in the New Enquiry dialog, and once set it drives the cost calculation through
 * the "bomId absent + costRefCode present -> direct GMDUpdateItem match"
 * short-circuit, so overwriting it would silently reprice a line. Anything
 * already holding a value is counted and left alone.
 *
 * A Contract Review row can hold a comma-joined list when its variant slot
 * matched more than one raw material (see `contractCostCodeRefResolver.ts`).
 * Such a value is never a valid `GMDUpdateItem.erpItemCode`, so it is skipped
 * and reported rather than written: a cell that looks filled but can never
 * resolve a cost is worse than a blank one.
 *
 * When several Contract Review rows share an item code the most recent contract
 * wins, ranked on `dateOfContract`, then `createdAt`, then `syncedAt`. Ties keep
 * the incumbent. `dateOfContract` is a `String?` stored in the sheet's
 * `DD-Mmm-YY` format, which `new Date()` cannot parse, so `parseGmdDate` is used
 * instead.
 */

export interface CostRefBackfillItem {
  id: string;
  erpItemCode: string | null;
  costRefCode: string | null;
}

export interface CostRefContractRow {
  itemCode: string | null;
  costCodeRef: string | null;
  dateOfContract: string | null;
  createdAt: Date;
  syncedAt: Date;
}

export interface CostRefFill {
  id: string;
  costRefCode: string;
}

export interface CostRefBackfillPlan {
  fills: CostRefFill[];
  /** Blank cells that received a single RM code. */
  filled: number;
  /** Blank cells whose source was a comma-joined list of RM codes. */
  multi: number;
  /** Blank cells with no Contract Review row for that item code. */
  noMatch: number;
  /** Cells that already had a value and were therefore left untouched. */
  alreadySet: number;
}

/** A single code is a fill candidate; a comma-joined list never is. */
function isSingleCode(value: string): boolean {
  return !value.includes(",");
}

/**
 * Recency as a lexicographic tuple, most significant first: contract date, then
 * row creation, then last sync. Two contract rows for one item code often share
 * a date (same order, split across contracts) and are frequently created and
 * synced in the same import, so all three levels are needed before the choice
 * is stable.
 */
type Recency = [number, number, number];

function recencyOf(row: CostRefContractRow): Recency {
  const date = parseGmdDate(row.dateOfContract)?.getTime();
  return [
    Number.isFinite(date) ? (date as number) : -Infinity,
    row.createdAt.getTime(),
    row.syncedAt.getTime(),
  ];
}

/** True when `next` is strictly more recent than `prev` on some level. */
function isNewer(next: Recency, prev: Recency): boolean {
  for (let i = 0; i < next.length; i++) {
    if (next[i] > prev[i]) return true;
    if (next[i] < prev[i]) return false;
  }
  return false;
}

function buildBestByCode(
  contractRows: CostRefContractRow[],
): Map<string, { value: string; recency: Recency }> {
  const best = new Map<string, { value: string; recency: Recency }>();

  for (const row of contractRows) {
    const value = (row.costCodeRef ?? "").trim();
    if (!value) continue;

    const key = normalizeContractKey(row.itemCode);
    if (!key) continue;

    const recency = recencyOf(row);
    const prev = best.get(key);
    // A row only displaces the incumbent when it is strictly newer. Rows equal
    // on every level are indistinguishable here, so the incumbent stands and
    // the outcome does not depend on which one the query returned first.
    if (prev && !isNewer(recency, prev.recency)) continue;
    best.set(key, { value, recency });
  }

  return best;
}

export function planCostRefBackfill(
  items: CostRefBackfillItem[],
  contractRows: CostRefContractRow[],
): CostRefBackfillPlan {
  const bestByCode = buildBestByCode(contractRows);
  const fills: CostRefFill[] = [];
  let filled = 0;
  let multi = 0;
  let noMatch = 0;
  let alreadySet = 0;

  for (const item of items) {
    if ((item.costRefCode ?? "").trim() !== "") {
      alreadySet++;
      continue;
    }

    const key = normalizeContractKey(item.erpItemCode);
    const entry = key ? bestByCode.get(key) : undefined;
    if (!entry) {
      noMatch++;
      continue;
    }

    if (!isSingleCode(entry.value)) {
      multi++;
      continue;
    }

    fills.push({ id: item.id, costRefCode: entry.value });
    filled++;
  }

  return { fills, filled, multi, noMatch, alreadySet };
}
