// Indent Listing display transform for the TPAV+SLV compound item.
//
// `TPAV+SLV` is a compound valve: an air valve (TPAV) supplied with an
// isolation sluice valve (SLV). Operations wants its balance counted under
// BOTH the standalone TPAV item and the standalone SLV item, split by variant
// (plain / 9523 / rising / rising+9523), and does not want a separate TPAV+SLV
// line in the listing.
//
// This runs at read time (the API), so the stored rows — including the
// TPAV+SLV rows — are never modified. Every in-app consumer that needs the
// merged total must go through `getMergedIndentListing()` in
// `lib/indentListingRead.ts` so the number can never diverge.
//
// Example: TPAV 100, SLV 200, TPAV+SLV 50 -> TPAV 150, SLV 250, no TPAV+SLV.

const ITEM_IDX = 0;
const SIZE_IDX = 1;
const PN_IDX = 2;
const MC_IDX = 3;
const TOTAL_IDX = 4;
const V_IDXS = [5, 6, 7, 8];
const CAT_IDXS = [9, 10, 11, 12];
const RM_IDXS = [13, 14, 15, 16];

const SLV_ITEM = "SLV";
const TPAV_ITEM = "TPAV";
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

function keyFor(row: unknown[]): string {
  return [
    normalizePart(row[SIZE_IDX]),
    normalizePart(row[PN_IDX]),
    normalizePart(row[MC_IDX]),
  ].join("||");
}

/**
 * Which TPAV slot a TPAV+SLV variant belongs to, from the category label alone.
 * TPAV's slot map differs from SLV's: plain/DI is V1, 9523 is V4, and CS/wafer
 * uses the spare V2. RISING is SLV-only, so a rising-only compound falls to V1.
 */
function tpavSlotForVariant(category: string): number {
  const c = category.toUpperCase();
  if (c.includes("9523")) return 3; // V4
  if (c.includes("DI")) return 0; // V1
  if (c.includes("CS") || c.includes("WAFER")) return 1; // V2 (spare)
  return 0; // V1
}

// RISING is an SLV-only attribute (no real TPAV-rising), so the SLV-only token
// is stripped from the label before it lands on a TPAV row. A label that was
// nothing but RISING becomes the plain air valve's "Base".
function tpavCategory(category: string): string {
  if (!category.trim()) return category;
  const parts = [
    ...new Set(
      category
        .split(",")
        .map((s) => s.replace(/\bRISING\b/gi, " ").trim())
        .filter((s) => s.length > 0),
    ),
  ];
  return parts.length > 0 ? parts.join(", ") : "Base";
}

// Add a variant amount (and its category / RM code) into one slot of a target
// row, merging labels without duplicates and only filling a blank RM code.
function addAmountToSlot(
  target: unknown[],
  slot: number,
  amount: unknown,
  category: string,
  rmCode: unknown,
) {
  if (Number.isNaN(parseNum(amount))) return;

  target[V_IDXS[slot]] = sumAmount(target[V_IDXS[slot]], amount);

  const add = category.trim();
  if (add) {
    const current = String(target[CAT_IDXS[slot]] ?? "").trim();
    const already = current
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .includes(add.toLowerCase());
    if (!already) target[CAT_IDXS[slot]] = current ? `${current}, ${add}` : add;
  }

  if (!String(target[RM_IDXS[slot]] ?? "").trim()) {
    const rm = String(rmCode ?? "").trim();
    if (rm) target[RM_IDXS[slot]] = rm;
  }
}

// A blank SLV/TPAV row for a key that has no stored row of its own. Filled in
// by the routing below, so its size/PN/MC still come from the TPAV+SLV source.
function makeTargetRow(item: string, source: unknown[]): unknown[] {
  return [
    item,
    source[SIZE_IDX],
    source[PN_IDX],
    source[MC_IDX],
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

/**
 * Route every `TPAV+SLV` row's variant amounts into the matching base `SLV`
 * and base `TPAV` rows (keyed by SIZE + PN RATING + MC RECEIVED/PENDING), then
 * drop the `TPAV+SLV` rows. Targets that do not exist yet are synthesized so no
 * balance is lost. `ids` is returned alongside `rows` so the caller can keep
 * them index-aligned (synthesized rows get a generated id).
 *
 * `sourceIds` is aligned with the output `rows`: the stored-row ids behind each
 * displayed row. A row a compound row was folded into lists its own id plus
 * every contributing `TPAV+SLV` id, so an edit can reach every stored row.
 */
export function applyTpavSlvMerge(
  rows: unknown[][],
  ids: string[],
): { rows: unknown[][]; ids: string[]; sourceIds: string[][] } {
  // Shallow copy of the list: untouched rows keep their original reference so
  // callers/tests can rely on identity; only rows we actually modify are cloned.
  const out = [...rows];
  const outIds = [...ids];
  const outSourceIds: string[][] = ids.map((id) => [id]);
  const cloned = new Set<number>();
  const mutable = (index: number): unknown[] => {
    if (!cloned.has(index)) {
      out[index] = [...out[index]];
      cloned.add(index);
    }
    return out[index];
  };

  const slvByKey = new Map<string, number>();
  const tpavByKey = new Map<string, number>();
  const tslvIndices: number[] = [];

  out.forEach((row, index) => {
    const item = normalizePart(row[ITEM_IDX]);
    if (item === SLV_ITEM) slvByKey.set(keyFor(row), index);
    else if (item === TPAV_ITEM) tpavByKey.set(keyFor(row), index);
    else if (item === TPAV_SLV_ITEM) tslvIndices.push(index);
  });

  const ensureTarget = (
    map: Map<string, number>,
    item: string,
    key: string,
    source: unknown[],
  ): number => {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const index = out.length;
    out.push(makeTargetRow(item, source));
    outIds.push(`syn::${key}::${item}`);
    // A synthesized row has no DB row of its own, so it starts with no sources
    // and collects only the contributing compound ids below.
    outSourceIds.push([]);
    map.set(key, index);
    return index;
  };

  for (const index of tslvIndices) {
    const source = out[index];
    const key = keyFor(source);

    const slvIndex = ensureTarget(slvByKey, SLV_ITEM, key, source);
    const tpavIndex = ensureTarget(tpavByKey, TPAV_ITEM, key, source);
    const slvTarget = mutable(slvIndex);
    const tpavTarget = mutable(tpavIndex);

    // The compound row is a stored source of both targets, so a hand-picked RM
    // code written to this displayed row also lands on the compound's DB row.
    const compoundId = ids[index];
    outSourceIds[slvIndex].push(compoundId);
    outSourceIds[tpavIndex].push(compoundId);

    for (let slot = 0; slot < V_IDXS.length; slot++) {
      const amount = source[V_IDXS[slot]];
      if (Number.isNaN(parseNum(amount))) continue;

      const category = String(source[CAT_IDXS[slot]] ?? "").trim();
      const rmCode = source[RM_IDXS[slot]];

      // SLV shares the TPAV+SLV slot map, so the variant stays in place.
      addAmountToSlot(slvTarget, slot, amount, category, rmCode);
      // TPAV's slot map differs, so the variant is re-homed.
      addAmountToSlot(
        tpavTarget,
        tpavSlotForVariant(category),
        amount,
        tpavCategory(category),
        rmCode,
      );
    }

    slvTarget[TOTAL_IDX] = sumAmount(slvTarget[TOTAL_IDX], source[TOTAL_IDX]);
    tpavTarget[TOTAL_IDX] = sumAmount(tpavTarget[TOTAL_IDX], source[TOTAL_IDX]);
  }

  const removed = new Set(tslvIndices);
  const finalRows: unknown[][] = [];
  const finalIds: string[] = [];
  const finalSourceIds: string[][] = [];
  out.forEach((row, index) => {
    if (removed.has(index)) return;
    finalRows.push(row);
    finalIds.push(outIds[index]);
    finalSourceIds.push(outSourceIds[index]);
  });

  return { rows: finalRows, ids: finalIds, sourceIds: finalSourceIds };
}
