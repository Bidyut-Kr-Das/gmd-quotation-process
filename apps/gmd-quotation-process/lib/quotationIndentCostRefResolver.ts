import { parseItem } from "./itemVersionResolver";
import { rmCodeSizeKey } from "./indentRmCodeResolver";
import { pnRatingBucket } from "./pnRatingMatcher";
import { indentCostRefKey } from "./contractCostCodeRefResolver";

/**
 * Gap-fills `EnquiryItem.costRefCode` (the COST CODE REF column) from the RM
 * codes resolved on the Indent Listing, for quotation lines that have NO BOM.
 *
 * This is the quotation-side counterpart of `contractCostCodeRefResolver`: an
 * indent row holds one RM code per V1..V4 variant slot, while a quotation line
 * has a single cost ref, so the slot is chosen from the quotation line's own
 * item name — `parseItem("SLV RISING 9523")` returns slot 4 and the line takes
 * `rmCodeV4`. The join runs through `parseItem` on both sides because a completed
 * V1-V4 recompute collapses `IndentListing.item` to its base item ("SLV") and
 * throws the variant suffixes away, so matching the raw strings would fail for
 * every already-collapsed row.
 *
 * Size is compared with `rmCodeSizeKey` and the PN rating with `pnRatingBucket`,
 * the same normalizers `indentRmCodeResolver` uses to reach the raw material
 * master, so a quotation size of "200MM" still matches an indent "200" and
 * "PN-16" matches an indent "PN-10/16". The indent side is indexed with
 * `indentCostRefKey`, which builds the same base-item/size/PN key.
 *
 * An indent key can hold both a RECEIVED and a PENDING row (MC Received/Pending
 * is part of the Indent Listing primary key). A quotation line carries no MC
 * status to disambiguate them, so such a pair is skipped rather than guessed: a
 * wrong cost ref is worse than a blank one.
 *
 * Only lines with no BOM are touched — a line that already resolved a BOM keeps
 * its BOM-derived cost — and only a BLANK cost ref is filled, mirroring
 * `planCostRefBackfill`. A slot that resolved to more than one raw material
 * stores a comma-joined list, which is never a valid `GMDUpdateItem.erpItemCode`,
 * so it is skipped and counted instead of written.
 *
 * This function only decides the cost ref. Matching it against the raw material
 * master for `productCost` is the caller's job, via the existing
 * "bomId absent + costRefCode present -> direct GMDUpdateItem match" path.
 */

export interface QuotationCostRefItem {
  id: string;
  itemName: string | null;
  size: string | null;
  pnRating: string | null;
  bomId: string | null;
  costRefCode: string | null;
}

export interface QuotationIndentRmCodeRow {
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
  rmCodeV1: string | null;
  rmCodeV2: string | null;
  rmCodeV3: string | null;
  rmCodeV4: string | null;
}

export interface QuotationCostRefFill {
  id: string;
  costRefCode: string;
}

export interface QuotationIndentCostRefPlan {
  fills: QuotationCostRefFill[];
  /** Blank cost refs that received a single RM code. */
  filled: number;
  /** Slots holding a comma-joined list, or a key with a Received/Pending pair. */
  ambiguous: number;
  /** Slots matched to an indent row whose variant column has no RM code. */
  unmatched: number;
  /** Lines with no indent row for their (item, size, PN rating). */
  noMatch: number;
  /** Lines whose item name carries no recognised base item / variant slot. */
  skippedNoItem: number;
  /** Lines skipped because they already have a BOM. */
  hasBom: number;
  /** Lines skipped because they already hold a cost ref. */
  alreadySet: number;
}

function buildIndentIndex(
  rows: QuotationIndentRmCodeRow[],
): Map<string, QuotationIndentRmCodeRow[]> {
  const index = new Map<string, QuotationIndentRmCodeRow[]>();

  for (const row of rows) {
    const key = indentCostRefKey(row);
    const existing = index.get(key);
    if (existing) {
      existing.push(row);
    } else {
      index.set(key, [row]);
    }
  }

  return index;
}

/** The variant column matching a parsed slot, 1-indexed. */
function rmCodeForSlot(row: QuotationIndentRmCodeRow, slot: number): string {
  const values = [row.rmCodeV1, row.rmCodeV2, row.rmCodeV3, row.rmCodeV4];
  return String(values[slot - 1] ?? "").trim();
}

export function planQuotationIndentCostRefs(
  items: QuotationCostRefItem[],
  indentRows: QuotationIndentRmCodeRow[],
): QuotationIndentCostRefPlan {
  const index = buildIndentIndex(indentRows);
  const fills: QuotationCostRefFill[] = [];
  let filled = 0;
  let ambiguous = 0;
  let unmatched = 0;
  let noMatch = 0;
  let skippedNoItem = 0;
  let hasBom = 0;
  let alreadySet = 0;

  for (const item of items) {
    // A line with a BOM keeps its BOM-derived cost; this fallback is only for
    // lines that never resolved a BOM.
    if ((item.bomId ?? "").trim() !== "") {
      hasBom++;
      continue;
    }

    // Never overwrite a user-entered / previously filled cost ref.
    if ((item.costRefCode ?? "").trim() !== "") {
      alreadySet++;
      continue;
    }

    const parsed = parseItem(item.itemName);
    if (!parsed.baseItem || !parsed.slot) {
      skippedNoItem++;
      continue;
    }

    const key = [
      parsed.baseItem,
      rmCodeSizeKey(item.size),
      pnRatingBucket(item.pnRating),
    ].join("||");

    const candidates = index.get(key);
    if (!candidates || candidates.length === 0) {
      noMatch++;
      continue;
    }

    // Several rows can only mean the Received/Pending pair, which a quotation
    // line cannot disambiguate. Skip rather than guess.
    if (candidates.length > 1) {
      ambiguous++;
      continue;
    }

    const code = rmCodeForSlot(candidates[0], parsed.slot);
    if (!code) {
      unmatched++;
      continue;
    }
    if (code.includes(",")) {
      ambiguous++;
      continue;
    }

    fills.push({ id: item.id, costRefCode: code });
    filled++;
  }

  return {
    fills,
    filled,
    ambiguous,
    unmatched,
    noMatch,
    skippedNoItem,
    hasBom,
    alreadySet,
  };
}
