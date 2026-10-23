import "server-only";
import { resolvePhysicalStockFlags, type PhysicalStockFlags } from "@gmd/physical-stock/flags";
import { BLANK_ONLY_HEADERS } from "@gmd/physical-stock/columns";
import { getCurrentUser } from "@/lib/auth-helpers";
import {
  physicalStockDuplicateErpHighlight,
  physicalStockEditableColumns,
  physicalStockHiddenColumns,
  physicalStockHiddenSidebar,
  physicalStockNewItem,
} from "@/flags";

/** Evaluates this app's Physical Stock flags for the current request. */
export async function getPhysicalStockFlags(): Promise<PhysicalStockFlags> {
  const [hiddenColumns, editableColumns, hiddenSidebar, newItem, duplicateErpHighlight, user] = await Promise.all([
    physicalStockHiddenColumns(),
    physicalStockEditableColumns(),
    physicalStockHiddenSidebar(),
    physicalStockNewItem(),
    physicalStockDuplicateErpHighlight(),
    getCurrentUser(),
  ]);
  // Blank ERP CODE + L/Dia dropdowns: admin/developer only. ERP CODE is not
  // added here: it was never editable in this app.
  const privileged = ["admin", "developer"].includes((user as { role?: string } | null)?.role ?? "");
  return resolvePhysicalStockFlags({
    hiddenColumns,
    editableColumns: privileged
      ? [...editableColumns, ...BLANK_ONLY_HEADERS.filter((h) => h !== "ERP CODE")]
      : editableColumns,
    hiddenSidebar,
    newItem,
    duplicateErpHighlight,
  });
}
