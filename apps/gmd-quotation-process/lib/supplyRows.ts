import {
  SUPPLY_HISTORY_HEADERS,
  dbItemToRow,
} from "@/lib/gmd_lib/supply-history-columns";
import { compareBomIdsDescending } from "@/lib/bomOrder";
import {
  SUPPLY_BOM_COST_HEADER,
  SUPPLY_BOM_ID_HEADER,
  SUPPLY_DISPLAY_HEADERS,
  SUPPLY_RM_COST_HEADER,
} from "@/lib/supplyDisplay";

/**
 * Display projection for the Supply History dashboard. Shared by the read API
 * and the paged server action so both emit byte-identical rows.
 */

export {
  SUPPLY_BOM_COST_HEADER,
  SUPPLY_BOM_ID_HEADER,
  SUPPLY_DISPLAY_HEADERS,
  SUPPLY_RM_COST_HEADER,
} from "@/lib/supplyDisplay";

const displayColumnMap = SUPPLY_DISPLAY_HEADERS.map((header) =>
  (SUPPLY_HISTORY_HEADERS as readonly string[]).indexOf(header),
);

const MERGE_FIELDS: Record<string, [string, string]> = {
  "Item Type": ["typeOfValve", "derivedItemType"],
  MOC: ["moc", "derivedMoc"],
  Size: ["sizeOfValve", "derivedSize"],
};

function formatCost(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

interface SupplyBomLink {
  bomItemId: string;
  bom: { bomId: string | null } | null;
  bomItem: { cost: unknown } | null;
  rawMaterial: { cost: unknown } | null;
}

interface SupplySelectedBomItem {
  id: string;
  cost: unknown;
  bom: { bomId: string | null } | null;
  rawMaterial: { cost: unknown } | null;
}

export type SupplyRowSource = Parameters<typeof dbItemToRow>[0] & {
  id: string;
  bomLinks: SupplyBomLink[];
  selectedBomItem: SupplySelectedBomItem | null;
};

export interface SupplyRowResult {
  row: unknown[];
  /** BOM IDs offered by the BOM ID dropdown for this row. */
  bomIdOptions: string[];
}

export function buildSupplyRow(item: SupplyRowSource): SupplyRowResult {
  const canonicalRow = dbItemToRow(item);
  const row = displayColumnMap.map((index) => canonicalRow[index]);

  for (const [header, [sheetField, derivedField]] of Object.entries(MERGE_FIELDS)) {
    const index = (SUPPLY_DISPLAY_HEADERS as readonly string[]).indexOf(header);
    if (index === -1) continue;
    const record = item as unknown as Record<string, unknown>;
    row[index] = record[sheetField] || record[derivedField] || null;
  }

  const bomIdOptions = [
    ...new Set(
      item.bomLinks
        .map((link) => link.bom?.bomId?.trim())
        .filter((value): value is string => !!value),
    ),
  ].sort(compareBomIdsDescending);

  // Remembered choice when it is still linked, otherwise the highest BOM.
  let selectedLink = item.selectedBomItem
    ? item.bomLinks.find((link) => link.bomItemId === item.selectedBomItem!.id)
    : undefined;
  if (!selectedLink && bomIdOptions.length > 0) {
    selectedLink = item.bomLinks.find(
      (link) => link.bom?.bomId?.trim() === bomIdOptions[0],
    );
  }

  const bomIdIndex = (SUPPLY_DISPLAY_HEADERS as readonly string[]).indexOf(
    SUPPLY_BOM_ID_HEADER,
  );
  const bomCostIndex = (SUPPLY_DISPLAY_HEADERS as readonly string[]).indexOf(
    SUPPLY_BOM_COST_HEADER,
  );
  const rmCostIndex = (SUPPLY_DISPLAY_HEADERS as readonly string[]).indexOf(
    SUPPLY_RM_COST_HEADER,
  );

  row[bomIdIndex] = selectedLink?.bom?.bomId?.trim() || null;
  row[bomCostIndex] =
    selectedLink?.bomItem?.cost != null
      ? formatCost(selectedLink.bomItem.cost)
      : null;
  row[rmCostIndex] =
    selectedLink?.rawMaterial?.cost != null
      ? formatCost(selectedLink.rawMaterial.cost)
      : null;

  return { row, bomIdOptions };
}
