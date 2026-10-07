import { pnRatingBucket } from "./pnRatingMatcher";

/**
 * Links Indent Listing rows to the raw material master (GMDUpdateItem) and
 * records the matching ERP item code — which is the RM code everywhere else in
 * this codebase — against each V1..V4 variant column.
 *
 * Only SLV, SLV METAL and TPAV+SLV are mapped for now. All sit under
 * L8 "TRADING VALVES" with L2 "SLUICE VALVE", and the item name only decides
 * the L4 component:
 *
 *   SLV       -> L4 = METAL TO RUBBER
 *   TPAV+SLV  -> L4 = METAL TO RUBBER  (its sluice-valve body is a plain SLV)
 *   SLV METAL -> L4 = METAL TO METAL
 *
 * TPAV+SLV shares SLV's L4 so it resolves to the same raw material code as the
 * matching SLV row (same size / PN rating / V slot); it is a distinct base item
 * only for the indent family totals, not for the raw-material lookup.
 *
 * Each V column is one rising/9523 variant, which is exactly the L6 standard on
 * the raw material side:
 *
 *   V1 -> NON-RISING        V2 -> NON-RISING-9523
 *   V3 -> RISING            V4 -> RISING-9523
 *
 * Size is compared after stripping the unit suffix ("200MM" -> "200") and the
 * PN rating is compared through `pnRatingBucket` on both sides, so a raw
 * material "PN-16" matches an indent "PN-10/16".
 *
 * Material is taken from the stored category rather than the item name, because
 * a completed recompute collapses `item` to the base item. A "CS" category
 * ("Rising CS" = cast/carbon steel) requires a CARBON STEEL/CAST STEEL raw
 * material, so those slots resolve to nothing rather than to a ductile iron
 * code of the wrong material. See `RM_CODE_CARBON_STEEL`.
 *
 * Only live raw materials (`newItemStatus` is null) are considered. CLOSED
 * history rows carry identical L-values and would match almost every indent
 * row, so they are ignored entirely — there is deliberately no fallback.
 */

export const RM_CODE_COMPONENT_BY_ITEM: Record<string, string> = {
  SLV: "METAL TO RUBBER",
  "TPAV+SLV": "METAL TO RUBBER",
  "SLV METAL": "METAL TO METAL",
};

export const RM_CODE_STD_BY_SLOT = [
  "NON-RISING",
  "NON-RISING-9523",
  "RISING",
  "RISING-9523",
] as const;

/**
 * L5- MATERIAL required by a "CS" category. The raw material master has no
 * carbon-steel METAL TO RUBBER valve and its carbon-steel rising sluice valves
 * are CLASS-rated only, so PN-rated "Rising CS" indents correctly resolve to
 * nothing instead of picking up a ductile iron code.
 */
export const RM_CODE_CARBON_STEEL = "CARBON STEEL/CAST STEEL";

/** L2-VALVE TYPE the sluice valve raw materials carry. */
export const RM_CODE_VALVE_TYPE = "SLUICE VALVE";

/** Substring of the L8 -ITEM CATEGORY value, which is "TRADING VALVES". */
export const RM_CODE_ITEM_CATEGORY = "TRADING VALVE";

export interface RawMaterialMatchRow {
  erpItemCode: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l7Dimension: string | null;
  l8ItemCategory: string | null;
}

export interface IndentRmCodeInput {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
  v4: string | null;
  v1Category: string | null;
  v2Category: string | null;
  v3Category: string | null;
  v4Category: string | null;
}

export interface IndentRmCodeUpdate {
  id: string;
  rmCodeV1: string;
  rmCodeV2: string;
  rmCodeV3: string;
  rmCodeV4: string;
}

export interface IndentRmCodePlan {
  updates: IndentRmCodeUpdate[];
  /** Populated V slots that matched exactly one raw material. */
  resolved: number;
  /** Populated V slots that matched more than one raw material. */
  ambiguous: number;
  /** Populated V slots with no live raw material at all. */
  unmatched: number;
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** "200MM", "200 mm" and "200" all collapse to "200". */
export function rmCodeSizeKey(value: string | null | undefined): string {
  return normalizeKeyPart(value).replace(/\s*(?:MM|IN|INCH)$/, "");
}

function rmCodeKey(
  size: string,
  component: string,
  std: string,
  pnBucket: string,
): string {
  return [size, normalizeKeyPart(component), normalizeKeyPart(std), pnBucket].join(
    "||",
  );
}

function isTradingValve(value: string | null | undefined): boolean {
  return normalizeKeyPart(value).includes(RM_CODE_ITEM_CATEGORY);
}

/**
 * The L5- MATERIAL a slot requires, derived from its stored category. Only a
 * "CS" category constrains the material; everything else matches any material,
 * which is what keeps a plain SLV / SLV METAL slot behaving as before.
 */
export function rmCodeRequiredMaterial(
  category: string | null | undefined,
): string | null {
  const raw = String(category ?? "").trim();
  if (!raw) return null;
  return /\bCS\b/.test(raw.toUpperCase()) ? RM_CODE_CARBON_STEEL : null;
}

/**
 * Indexes raw materials by the key the indent side is matched on, then by
 * L5- MATERIAL. A Set is used per material because `GMDUpdateItem.erpItemCode`
 * has no unique index and duplicate rows do exist in the sheet.
 */
function buildRmCodeIndex(
  rows: RawMaterialMatchRow[],
): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>();

  for (const row of rows) {
    const erpItemCode = (row.erpItemCode ?? "").trim();
    if (!erpItemCode) continue;
    if (!isTradingValve(row.l8ItemCategory)) continue;
    if (normalizeKeyPart(row.l2ValveType) !== RM_CODE_VALVE_TYPE) continue;

    const size = rmCodeSizeKey(row.l3Dia);
    const component = normalizeKeyPart(row.l4Component);
    const std = normalizeKeyPart(row.l6Std);
    const pnBucket = pnRatingBucket(row.l7Dimension);
    if (!size || !component || !std || !pnBucket) continue;

    const key = rmCodeKey(size, component, std, pnBucket);
    const material = normalizeKeyPart(row.l5Material);
    let byMaterial = index.get(key);
    if (!byMaterial) {
      byMaterial = new Map();
      index.set(key, byMaterial);
    }
    const codes = byMaterial.get(material);
    if (codes) {
      codes.add(erpItemCode);
    } else {
      byMaterial.set(material, new Set([erpItemCode]));
    }
  }

  return index;
}

function collectCodes(
  index: Map<string, Map<string, Set<string>>>,
  key: string,
  material: string | null,
): string[] {
  const byMaterial = index.get(key);
  if (!byMaterial) return [];

  const codes = new Set<string>();
  if (material === null) {
    for (const bucket of byMaterial.values()) {
      for (const code of bucket) codes.add(code);
    }
  } else {
    const bucket = byMaterial.get(normalizeKeyPart(material));
    if (bucket) for (const code of bucket) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * Resolves the RM code for every populated V1..V4 slot of every SLV / SLV METAL
 * / TPAV+SLV indent row. Rows for any other item (BFV, DPCV, NRV, ...) produce
 * no update.
 *
 * `rawMaterials` must already be restricted to live rows by the caller; this
 * function never falls back to CLOSED history.
 */
export function planIndentRmCodes(
  indentRows: IndentRmCodeInput[],
  rawMaterials: RawMaterialMatchRow[],
): IndentRmCodePlan {
  const index = buildRmCodeIndex(rawMaterials);
  const updates: IndentRmCodeUpdate[] = [];
  let resolved = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const row of indentRows) {
    const component = RM_CODE_COMPONENT_BY_ITEM[normalizeKeyPart(row.item)];
    if (!component) continue;

    const size = rmCodeSizeKey(row.size);
    const pnBucket = pnRatingBucket(row.pnRating);
    if (!size || !pnBucket) continue;

    const balances = [row.v1, row.v2, row.v3, row.v4];
    const categories = [
      row.v1Category,
      row.v2Category,
      row.v3Category,
      row.v4Category,
    ];
    const codes: string[] = [];

    for (let slot = 0; slot < 4; slot++) {
      // An empty V column has no variant, so it has no RM code either.
      if (String(balances[slot] ?? "").trim() === "") {
        codes.push("");
        continue;
      }

      const key = rmCodeKey(
        size,
        component,
        RM_CODE_STD_BY_SLOT[slot],
        pnBucket,
      );
      const matches = collectCodes(
        index,
        key,
        rmCodeRequiredMaterial(categories[slot]),
      );

      if (matches.length === 0) {
        unmatched++;
        codes.push("");
      } else {
        if (matches.length === 1) resolved++;
        else ambiguous++;
        codes.push(matches.join(", "));
      }
    }

    updates.push({
      id: row.id,
      rmCodeV1: codes[0],
      rmCodeV2: codes[1],
      rmCodeV3: codes[2],
      rmCodeV4: codes[3],
    });
  }

  return { updates, resolved, ambiguous, unmatched };
}
