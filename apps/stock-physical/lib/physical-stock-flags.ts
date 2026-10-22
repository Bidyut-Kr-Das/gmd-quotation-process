import "server-only";
import { resolvePhysicalStockFlags, type PhysicalStockFlags } from "@gmd/physical-stock/flags";
import {
  physicalStockDuplicateErpHighlight,
  physicalStockEditableColumns,
  physicalStockHiddenColumns,
  physicalStockHiddenSidebar,
  physicalStockNewItem,
  physicalStockSync,
} from "@/flags";

/** Evaluates this app's Physical Stock flags for the current request. */
export async function getPhysicalStockFlags(): Promise<PhysicalStockFlags> {
  const [hiddenColumns, editableColumns, hiddenSidebar, newItem, duplicateErpHighlight, sync] = await Promise.all([
    physicalStockHiddenColumns(),
    physicalStockEditableColumns(),
    physicalStockHiddenSidebar(),
    physicalStockNewItem(),
    physicalStockDuplicateErpHighlight(),
    physicalStockSync(),
  ]);
  return resolvePhysicalStockFlags({ hiddenColumns, editableColumns, hiddenSidebar, newItem, duplicateErpHighlight, sync });
}
