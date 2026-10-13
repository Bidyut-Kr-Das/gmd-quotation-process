import { PHYSICAL_COL_INDEX_TO_DB_FIELD } from "./physical-stock-columns";
import type { PhysicalStockRow } from "@/lib/physicalStockSlice";

const FIELD_BY_INDEX = Object.keys(PHYSICAL_COL_INDEX_TO_DB_FIELD)
  .map(Number)
  .sort((a, b) => a - b)
  .map((i) => PHYSICAL_COL_INDEX_TO_DB_FIELD[i]);

export function physicalStockRowToArray(row: PhysicalStockRow): unknown[] {
  return FIELD_BY_INDEX.map(
    (field) => row[field as keyof PhysicalStockRow] ?? "",
  );
}
