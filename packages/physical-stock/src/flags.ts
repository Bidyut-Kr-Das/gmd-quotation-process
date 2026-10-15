import {
  EDITABLE_CANDIDATES,
  fieldOf,
  type EditableHeader,
  type PhysicalStockHeader,
} from "./columns";

// Per-app switches for the Physical Stock page. This file only defines WHAT
// can be switched and the defaults; each app decides the values with the
// Flags SDK (apps/<app>/flags.ts) and passes a plain PhysicalStockFlags in.
// Plain TS, safe to import from both client and server code.

export const SIDEBAR_SECTIONS = ["qty", "value", "majorMinor"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export interface PhysicalStockFlags {
  /** Not shown in the table. Data still loads, so the sidebar sums still work. */
  hiddenColumns: PhysicalStockHeader[];
  /** Editable in the UI and accepted by the server. */
  editableColumns: EditableHeader[];
  hiddenSidebar: SidebarSection[];
  /** "New" button + dialog with an auto-generated ERP code. Needs actions.create. */
  newItem: boolean;
  /** Highlight rows that share an ERP code. */
  duplicateErpHighlight: boolean;
}

export const DEFAULT_PHYSICAL_STOCK_FLAGS: PhysicalStockFlags = {
  hiddenColumns: [],
  editableColumns: [],
  hiddenSidebar: [],
  newItem: false,
  duplicateErpHighlight: false,
};

export function resolvePhysicalStockFlags(
  partial: Partial<PhysicalStockFlags>,
): PhysicalStockFlags {
  return { ...DEFAULT_PHYSICAL_STOCK_FLAGS, ...partial };
}

/** DB fields updateField may write under these flags. BOM ID has its own action. */
export function editableFieldsFor(flags: PhysicalStockFlags): Set<string> {
  const out = new Set<string>();
  for (const header of flags.editableColumns) {
    if (header === "BOM ID" || !EDITABLE_CANDIDATES.includes(header)) continue;
    const field = fieldOf(header);
    if (field) out.add(field);
  }
  return out;
}
