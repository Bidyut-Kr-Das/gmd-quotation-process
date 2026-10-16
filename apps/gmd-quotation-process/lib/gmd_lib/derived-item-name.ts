/**
 * Builds the `RawMaterial.itemNameDerived` value from the L-level sheet
 * columns.
 *
 * Single source of truth shared by the inline-edit server action
 * (`app/actions.ts`), the backfill script (`scripts/populate-derived-item-name.ts`)
 * and the scheduled sync (`schedular_function/derived-item-name.ts`).
 *
 * Note: `l1` is intentionally not part of the derivation.
 */

/** L-level columns the derived name is assembled from. */
export interface DerivedItemNameInput {
  l8ItemCategory: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l7Dimension: string | null;
}

/**
 * Gearboxes omit the valve-type prefix and are built from component/material/
 * dimension only. Everything else joins the full L8 -> L7 chain.
 */
export function buildDerivedItemName(item: DerivedItemNameInput): string {
  const l8 = (item.l8ItemCategory ?? "").trim();
  const isGearbox = l8.toUpperCase().includes("GEAR BOX");

  const order = isGearbox
    ? [item.l4Component, item.l5Material, item.l7Dimension]
    : [
        item.l8ItemCategory,
        item.l2ValveType,
        item.l3Dia,
        item.l4Component,
        item.l5Material,
        item.l6Std,
        item.l7Dimension,
      ];

  const seen = new Set<string>();
  const parts: string[] = [];

  for (const raw of order) {
    let v = (raw ?? "").trim();
    if (!v) continue;

    const up = v.toUpperCase();
    if (up === "TRADING VALVE" || up === "TRADING VALVES") v = "TV";
    else if (up.includes("GEAR BOX")) v = v.replace(/gear box/gi, "GB");

    // "TRADING VALVE" and "TRADING VALVES" are the same part, so the dedupe
    // key ignores a trailing plural S.
    const key = v.toUpperCase().replace(/S$/, "");
    if (seen.has(key)) continue;

    seen.add(key);
    parts.push(v);
  }

  return parts.join("-");
}
