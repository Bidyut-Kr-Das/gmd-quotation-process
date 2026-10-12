import { pnRatingBucket } from "./pnRatingMatcher";

/**
 * Links Indent Listing rows to the raw material master (GMDUpdateItem) and
 * records the matching ERP item code — which is the RM code everywhere else in
 * this codebase — against each V1..V4 variant column.
 *
 * SLV, SLV METAL and TPAV+SLV sit under L8 "TRADING VALVES" with L2
 * "SLUICE VALVE", and the item name only decides the L4 component:
 *
 *   SLV       -> L4 = METAL TO RUBBER
 *   TPAV+SLV  -> L4 = METAL TO RUBBER  (its sluice-valve body is a plain SLV)
 *   SLV METAL -> L4 = METAL TO METAL
 *
 * TPAV+SLV shares SLV's L4 so it resolves to the same raw material code as the
 * matching SLV row (same size / PN rating / V slot); it is a distinct base item
 * only for the indent family totals, not for the raw-material lookup.
 *
 * NRV sits under L8 "TRADING VALVES" with L2 "CHECK VALVE". The indent side has
 * no L4 component for it, so the raw material is matched on size / PN rating /
 * L6 alone (L4 is not constrained):
 *
 *   NRV       -> L2 = CHECK VALVE
 *
 * Each V column is one variant, which is exactly the L6 standard on the raw
 * material side. The standards differ per valve type:
 *
 *   SLUICE VALVE: V1 -> NON-RISING        V2 -> NON-RISING-9523
 *                 V3 -> RISING            V4 -> RISING-9523
 *   CHECK VALVE:  V1 -> SWING TYPE        V2 -> SWING TYPE 9523
 *                 (V3/V4 have no standard, so those slots never resolve)
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

/** L2-VALVE TYPE the sluice valve raw materials carry. */
export const RM_CODE_VALVE_TYPE = "SLUICE VALVE";

/** L2-VALVE TYPE the non-return (check) valve raw materials carry. */
export const RM_CODE_CHECK_VALVE_TYPE = "CHECK VALVE";

/** Every L2-VALVE TYPE the resolver understands. */
export const RM_CODE_VALVE_TYPES = [
  RM_CODE_VALVE_TYPE,
  RM_CODE_CHECK_VALVE_TYPE,
] as const;

/** Substring of the L8 -ITEM CATEGORY value, which is "TRADING VALVES". */
export const RM_CODE_ITEM_CATEGORY = "TRADING VALVE";

/**
 * L6 standard per V slot, keyed by the raw material's L2-VALVE TYPE. A null
 * entry means the valve type has no variant in that slot, so a populated V
 * column there is never matched.
 */
export const RM_CODE_STD_BY_SLOT_BY_VALVE_TYPE: Record<
  string,
  readonly (string | null)[]
> = {
  [RM_CODE_VALVE_TYPE]: ["NON-RISING", "NON-RISING-9523", "RISING", "RISING-9523"],
  [RM_CODE_CHECK_VALVE_TYPE]: ["SWING TYPE", "SWING TYPE 9523", null, null],
};

/** Sluice-valve standards, kept for callers that only deal with the SLV family. */
export const RM_CODE_STD_BY_SLOT =
  RM_CODE_STD_BY_SLOT_BY_VALVE_TYPE[RM_CODE_VALVE_TYPE];

/**
 * Indent item -> raw-material lookup. `component` is the required L4 value, or
 * null when the raw material is matched on size / PN / L6 alone (NRV has no
 * component on the indent side).
 */
export const RM_CODE_MATCH_BY_ITEM: Record<
  string,
  { valveType: string; component: string | null }
> = {
  SLV: { valveType: RM_CODE_VALVE_TYPE, component: "METAL TO RUBBER" },
  "TPAV+SLV": { valveType: RM_CODE_VALVE_TYPE, component: "METAL TO RUBBER" },
  "SLV METAL": { valveType: RM_CODE_VALVE_TYPE, component: "METAL TO METAL" },
  NRV: { valveType: RM_CODE_CHECK_VALVE_TYPE, component: null },
};

/** L4 component per indent item, kept for callers of the sluice-valve family. */
export const RM_CODE_COMPONENT_BY_ITEM: Record<string, string> = {
  SLV: "METAL TO RUBBER",
  "TPAV+SLV": "METAL TO RUBBER",
  "SLV METAL": "METAL TO METAL",
};

/**
 * L5- MATERIAL required by a "CS" category. The raw material master has no
 * carbon-steel METAL TO RUBBER valve and its carbon-steel rising sluice valves
 * are CLASS-rated only, so PN-rated "Rising CS" indents correctly resolve to
 * nothing instead of picking up a ductile iron code.
 */
export const RM_CODE_CARBON_STEEL = "CARBON STEEL/CAST STEEL";

/** Component key used when an item does not constrain the L4 component. */
const WILDCARD_COMPONENT = "*";

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

/**
 * Standards are compared with hyphen/space separators collapsed, so a raw
 * material "NON-RISING-9523" meets an indent "Non Rising 9523" and a
 * "SWING TYPE-9523" meets "Swing type 9523".
 */
function normalizeStd(value: unknown): string {
  return normalizeKeyPart(value).replace(/[-\/]+/g, " ");
}

function rmCodeKey(
  valveType: string,
  size: string,
  component: string,
  std: string,
  pnBucket: string,
): string {
  return [
    normalizeKeyPart(valveType),
    size,
    normalizeKeyPart(component),
    normalizeStd(std),
    pnBucket,
  ].join("||");
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
function isKnownValveType(value: string): boolean {
  return (RM_CODE_VALVE_TYPES as readonly string[]).includes(value);
}

function buildRmCodeIndex(
  rows: RawMaterialMatchRow[],
): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>();

  for (const row of rows) {
    const erpItemCode = (row.erpItemCode ?? "").trim();
    if (!erpItemCode) continue;
    if (!isTradingValve(row.l8ItemCategory)) continue;

    const valveType = normalizeKeyPart(row.l2ValveType);
    if (!isKnownValveType(valveType)) continue;

    const size = rmCodeSizeKey(row.l3Dia);
    // Sluice valves are separated by L4 (METAL TO RUBBER vs METAL TO METAL);
    // check valves are matched without constraining L4.
    const component =
      valveType === RM_CODE_VALVE_TYPE
        ? normalizeKeyPart(row.l4Component)
        : WILDCARD_COMPONENT;
    const std = normalizeStd(row.l6Std);
    const pnBucket = pnRatingBucket(row.l7Dimension);
    if (!size || !component || !std || !pnBucket) continue;

    const key = rmCodeKey(valveType, size, component, std, pnBucket);
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
 * / TPAV+SLV / NRV indent row. Rows for any other item (BFV, DPCV, ...) produce
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
    const config = RM_CODE_MATCH_BY_ITEM[normalizeKeyPart(row.item)];
    if (!config) continue;

    const stdBySlot =
      RM_CODE_STD_BY_SLOT_BY_VALVE_TYPE[config.valveType] ?? [];
    const component =
      config.component === null
        ? WILDCARD_COMPONENT
        : normalizeKeyPart(config.component);

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
      const std = stdBySlot[slot];
      // An empty V column has no variant, and a slot with no standard for this
      // valve type has no raw material, so neither gets an RM code.
      if (String(balances[slot] ?? "").trim() === "" || !std) {
        codes.push("");
        continue;
      }

      const key = rmCodeKey(
        config.valveType,
        size,
        component,
        std,
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
