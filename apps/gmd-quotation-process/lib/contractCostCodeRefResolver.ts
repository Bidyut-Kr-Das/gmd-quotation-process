import { pnRatingBucket } from "./pnRatingMatcher";
import { parseItem } from "./itemVersionResolver";
import { rmCodeSizeKey } from "./indentRmCodeResolver";

/**
 * Pushes the RM codes resolved on the Indent Listing into the Contract Review
 * `costCodeRef` field, which is rendered as the COST CODE REF column beside
 * ITEM_CODE.
 *
 * An indent row holds one RM code per V1..V4 variant slot, while a Contract
 * Review row has a single cost ref, so the slot is chosen from the Contract
 * Review row's own item name: `parseItem("SLV RISING 9523")` returns slot 4 and
 * that row therefore takes `rmCodeV4`. This is why the join runs through
 * `parseItem` on both sides — a completed V1-V4 recompute collapses
 * `IndentListing.item` to its base item ("SLV") and throws the variant suffixes
 * away, so matching the raw strings would fail for every already-collapsed row.
 *
 * Size is compared with `rmCodeSizeKey` and the PN rating with
 * `pnRatingBucket`, the same normalizers `indentRmCodeResolver` uses to reach the
 * raw material master, so a Contract Review size of "200MM" still matches an
 * indent "200" and "PN-16" matches an indent "PN-10/16".
 *
 * MC Received/Pending is part of the Indent Listing primary key, so the same
 * (item, size, PN) can exist twice with balances in different slots. The row
 * with a matching MC status wins; if the MC status does not match either one is
 * used only when the key is unambiguous. Guessing between a received/pending
 * pair would hand a rising-stem code to a plain SLV contract.
 *
 * A slot that resolved to more than one raw material stores a comma-joined list
 * (see `planIndentRmCodes`). That list is passed through verbatim — the same CSV
 * convention `rmCodeForActuator` / `rmCodeForGb` already use — and counted as
 * `ambiguous` so the operator can see it, because a multi-code value is not
 * usable as a direct cost lookup key.
 */

export interface ContractCostRefSource {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
  costCodeRef: string | null;
}

export interface IndentRmCodeRow {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
  rmCodeV1: string | null;
  rmCodeV2: string | null;
  rmCodeV3: string | null;
  rmCodeV4: string | null;
}

export interface ContractCostRefUpdate {
  id: string;
  costCodeRef: string | null;
}

export interface ContractCostRefPlan {
  updates: ContractCostRefUpdate[];
  /** Rows that took a single RM code off their variant slot. */
  resolved: number;
  /** Rows whose slot held a comma-joined list of more than one RM code. */
  ambiguous: number;
  /** Rows matched to an indent row whose variant slot has no RM code. */
  unmatched: number;
  /** Rows whose `item` is blank or carries no recognised base item. */
  skippedNoItem: number;
  /** Rows with no indent row for their (item, size, PN rating). */
  skippedNoIndent: number;
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Indent rows are keyed by base item, not by their raw name, so a collapsed
 * "SLV" and an un-collapsed "SLV RISING 9523" land on the same entry and the
 * table resolves identically before and after a recompute.
 */
export function indentCostRefKey(item: {
  item: string | null;
  size: string | null;
  pnRating: string | null;
}): string {
  const baseItem = parseItem(item.item).baseItem ?? normalizeKeyPart(item.item);
  return [baseItem, rmCodeSizeKey(item.size), pnRatingBucket(item.pnRating)].join(
    "||",
  );
}

function buildIndentIndex(
  rows: IndentRmCodeRow[],
): Map<string, IndentRmCodeRow[]> {
  const index = new Map<string, IndentRmCodeRow[]>();

  for (const row of rows) {
    const key = indentCostRefKey(row);
    if (!key) continue;
    const existing = index.get(key);
    if (existing) {
      existing.push(row);
    } else {
      index.set(key, [row]);
    }
  }

  return index;
}

/**
 * The MC status is part of the Indent Listing primary key, so a key can hold
 * both a RECEIVED and a PENDING row with balances in different variant slots.
 * An exact status match is preferred; anything else is only accepted when the
 * key is unambiguous, so a rising-stem code is never handed to a plain SLV
 * contract by guesswork.
 */
function pickIndentRow(
  candidates: IndentRmCodeRow[],
  mcReceivedPending: string | null,
): IndentRmCodeRow | null {
  if (candidates.length === 1) return candidates[0];

  const wanted = normalizeKeyPart(mcReceivedPending);
  if (!wanted) return null;

  const exact = candidates.filter(
    (row) => normalizeKeyPart(row.mcReceivedPending) === wanted,
  );
  return exact.length === 1 ? exact[0] : null;
}

function rmCodeForSlot(row: IndentRmCodeRow, slot: number): string {
  const values = [row.rmCodeV1, row.rmCodeV2, row.rmCodeV3, row.rmCodeV4];
  return String(values[slot - 1] ?? "").trim();
}

export function planContractCostCodeRefs(
  contractRows: ContractCostRefSource[],
  indentRows: IndentRmCodeRow[],
): ContractCostRefPlan {
  const index = buildIndentIndex(indentRows);
  const updates: ContractCostRefUpdate[] = [];
  let resolved = 0;
  let ambiguous = 0;
  let unmatched = 0;
  let skippedNoItem = 0;
  let skippedNoIndent = 0;

  for (const row of contractRows) {
    const { baseItem, slot } = parseItem(row.item);
    if (!baseItem || !slot) {
      skippedNoItem++;
      continue;
    }

    const key = [
      baseItem,
      rmCodeSizeKey(row.size),
      pnRatingBucket(row.pnRating),
    ].join("||");

    const candidates = index.get(key);
    if (!candidates || candidates.length === 0) {
      skippedNoIndent++;
      // Always emit, so a code that no longer resolves is cleared rather than
      // left behind as a stale value.
      updates.push({ id: row.id, costCodeRef: null });
      continue;
    }

    const match = pickIndentRow(candidates, row.mcReceivedPending);
    if (!match) {
      // An ambiguous received/pending pair is treated as no match at all: a
      // wrong cost ref is worse than a blank one.
      skippedNoIndent++;
      updates.push({ id: row.id, costCodeRef: null });
      continue;
    }

    const code = rmCodeForSlot(match, slot);
    if (!code) {
      unmatched++;
      updates.push({ id: row.id, costCodeRef: null });
      continue;
    }

    if (code.includes(",")) {
      ambiguous++;
    } else {
      resolved++;
    }
    updates.push({ id: row.id, costCodeRef: code });
  }

  return {
    updates,
    resolved,
    ambiguous,
    unmatched,
    skippedNoItem,
    skippedNoIndent,
  };
}
