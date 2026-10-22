import { pnRatingBucket } from "./pnRatingMatcher";

export interface ContractReviewSourceRow {
  item?: string | null;
  size?: string | null;
  pnRating?: string | null;
  mcReceivedPending?: string | null;
  balBillAgCont?: number | string | null;
  status?: string | null;
}

export interface IndentGroup {
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string;
  sum: number;
}

export interface LiveGroupPlan {
  groups: Map<string, IndentGroup>;
  scanned: number;
  included: number;
  skippedNonLive: number;
  skippedNotIndentable: number;
}

export interface StaleIndentInput {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
}

const INDENT_MC_VALUES = new Set(["RECEIVED", "PENDING"]);

function normalizeKeyPart(value: unknown): string {
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

/**
 * A Contract Review row is "live" when its STATUS is blank. Any populated
 * status — CLOSED, COMPLETED, TO BE CLOSED, HOLD, DUPLICATE, ... — means the
 * contract is no longer live and must not feed the indent listing. This mirrors
 * the flow tree's "Live" node (components/graph_flow/tree.ts).
 */
export function isLiveStatus(status: unknown): boolean {
  return String(status ?? "").trim() === "";
}

/** Only MC Received / MC Pending rows feed the indent listing. */
export function isIndentableMc(mcReceivedPending: unknown): boolean {
  return INDENT_MC_VALUES.has(
    String(mcReceivedPending ?? "").trim().toUpperCase(),
  );
}

/**
 * Normalized [item, size, bucketed PN rating, MC received/pending] key. Must
 * stay identical to the key used when matching existing IndentListing rows.
 */
export function indentGroupKey(row: {
  item?: string | null;
  size?: string | null;
  pnRating?: string | null;
  mcReceivedPending?: string | null;
}): string {
  return [
    normalizeKeyPart(row.item),
    normalizeKeyPart(row.size),
    normalizeKeyPart(pnRatingBucket(row.pnRating)),
    normalizeKeyPart(row.mcReceivedPending),
  ].join("||");
}

/**
 * Group live Contract Review rows into indent listing groups keyed by
 * item/size/PN-rating-bucket/MC-status, summing BAL BILL AG CONT.
 *
 * Rows are skipped when MC Received/Pending is not RECEIVED/PENDING, or when
 * STATUS is not blank. A group containing both live and non-live rows sums only
 * the live rows' balances.
 */
export function planLiveIndentGroups(
  rows: ContractReviewSourceRow[],
): LiveGroupPlan {
  const groups = new Map<string, IndentGroup>();
  let included = 0;
  let skippedNonLive = 0;
  let skippedNotIndentable = 0;

  for (const row of rows) {
    if (!isIndentableMc(row.mcReceivedPending)) {
      skippedNotIndentable++;
      continue;
    }
    if (!isLiveStatus(row.status)) {
      skippedNonLive++;
      continue;
    }
    included++;

    const item = row.item?.trim() || null;
    const size = row.size?.trim() || null;
    const pnRating = pnRatingBucket(row.pnRating) || null;
    const mcReceivedPending = String(row.mcReceivedPending ?? "").trim();
    const key = indentGroupKey({
      item,
      size,
      pnRating,
      mcReceivedPending,
    });

    const value = parseNum(row.balBillAgCont);
    const existing = groups.get(key);
    if (existing) {
      if (!isNaN(value)) existing.sum += value;
    } else {
      groups.set(key, {
        item,
        size,
        pnRating,
        mcReceivedPending,
        sum: isNaN(value) ? 0 : value,
      });
    }
  }

  return {
    groups,
    scanned: rows.length,
    included,
    skippedNonLive,
    skippedNotIndentable,
  };
}

/**
 * Ids of existing IndentListing rows that no longer have any live Contract
 * Review source rows behind them. These are removed during sync so the
 * dashboard only ever shows live data instead of accumulating leftovers from
 * contracts that were closed since the last sync.
 */
export function planStaleIndentDeletes(
  rows: StaleIndentInput[],
  liveKeys: Iterable<string>,
): string[] {
  const live = new Set(liveKeys);
  return rows
    .filter((row) => !live.has(indentGroupKey(row)))
    .map((row) => row.id);
}
