import {
  CONTRACT_REVIEW_HEADERS,
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
} from "./lib/columns";

// Per-app switches for the Contract Review page. This file only defines WHAT
// can be switched and the safe defaults; each app decides the values (with the
// Flags SDK) and passes a plain ContractReviewFlags object in. Plain TS, so it
// is safe to import from both client and server code.

export type ContractReviewHeader = (typeof CONTRACT_REVIEW_HEADERS)[number];

export const SIDEBAR_SECTIONS = [
  "contractCount",
  "filters",
  "breakdown",
  "rateOrderQty",
  "rateBalBill",
  "quantity",
  "rateMcQty",
  "rateBalDiQty",
  "rateBalMcQty",
  "totalCostExGst",
  "totalCostIncGst",
  "totalVaPct",
] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export interface ContractReviewFlags {
  /** Removed everywhere: table, chips, filters, flow nodes, export, data, edits. */
  disabledColumns: ContractReviewHeader[];
  /** Still shown, but no edits (UI and server). */
  readOnlyColumns: ContractReviewHeader[];
  flowDiagram: boolean;
  excelExport: boolean;
  hiddenSidebar: SidebarSection[];
}

export const DEFAULT_CONTRACT_REVIEW_FLAGS: ContractReviewFlags = {
  disabledColumns: [],
  readOnlyColumns: [],
  flowDiagram: true,
  excelExport: true,
  hiddenSidebar: [],
};

export function resolveContractReviewFlags(
  partial: Partial<ContractReviewFlags>,
): ContractReviewFlags {
  return { ...DEFAULT_CONTRACT_REVIEW_FLAGS, ...partial };
}

export function columnAccess(flags: ContractReviewFlags) {
  const disabled = new Set<string>(flags.disabledColumns);
  const readOnly = new Set<string>(flags.readOnlyColumns);
  const hiddenSidebar = new Set<string>(flags.hiddenSidebar);
  return {
    isEnabled: (header: string) => !disabled.has(header),
    isEditable: (header: string) => !disabled.has(header) && !readOnly.has(header),
    showSection: (section: SidebarSection) => !hiddenSidebar.has(section),
  };
}

/** DB field -> header, so the server can map an edited field back to its column. */
const DB_FIELD_TO_HEADER = new Map(
  Object.entries(CONTRACT_REVIEW_HEADER_TO_DB_FIELD).map(([h, f]) => [f, h]),
);

export function headerForField(field: string): string | undefined {
  return DB_FIELD_TO_HEADER.get(field);
}
