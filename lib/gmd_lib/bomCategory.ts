/**
 * Shared classification for the Contract Review `BOM ID` column filter.
 *
 * The filter on that column is a *category* filter, not a value filter: it picks
 * how many candidate BOM IDs exist for a row's item code, not which BOM ID the
 * cell currently holds. Two independent filter engines implement that rule:
 *
 *   - `components/gmd_dashboard/GMDUpdateTable.tsx` -> `rowPassesFilters`
 *   - `app/contract_review/page.tsx` -> `matchesTableFilters`
 *
 * The second one previously had no such branch and fell through to a generic
 * `cellValue.includes(filterValue)` text match, so selecting "Single" rejected
 * every row (no BOM id string contains the substring "single") and zeroed the
 * Contract Review sidebar, graph counts and CONTRACT NO metadata. Both engines
 * now call this helper so the two cannot drift apart again.
 *
 * Note this describes *candidate availability*, not the current cell value: a
 * row can hold a saved BOM ID yet classify as "Blanks" when its item code has
 * no candidate BOMs at all (the cell renders "No BOM exists" in that case).
 */

export const BOM_ID_CATEGORIES = ["Blanks", "Single", "Dropdown"] as const;

export type BomIdCategory = (typeof BOM_ID_CATEGORIES)[number];

/** Options for the BOM ID column's filter control, including the "no filter" value. */
export const BOM_ID_FILTER_VALUES = ["All", ...BOM_ID_CATEGORIES] as const;

export const BOM_ID_COLUMN = "BOM ID";

export function getBomIdCategory(
  options: string[] | null | undefined,
): BomIdCategory {
  if (!options || options.length === 0) return "Blanks";
  if (options.length === 1) return "Single";
  return "Dropdown";
}
