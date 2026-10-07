import { flag } from "flags/next";
import type { ContractReviewHeader, SidebarSection } from "@gmd/contract-review/flags";

// Feature flags for this app. Each decide() is the single place that knows
// where a value comes from: today a constant in this file; later it can read
// an env var, a database row or a provider without touching anything else.
// Flag keys are the same in every app; only the values differ.

// Tender does not show the C / N batch columns, chips or filters.
export const contractReviewDisabledColumns = flag<ContractReviewHeader[]>({
  key: "contract-review-disabled-columns",
  description: "Contract Review columns removed entirely (table, chips, filters, data, edits)",
  defaultValue: [],
  decide: () => ["C BATCH", "N BATCH"],
});

export const contractReviewReadOnlyColumns = flag<ContractReviewHeader[]>({
  key: "contract-review-readonly-columns",
  description: "Contract Review columns shown but not editable",
  defaultValue: [],
  decide: () => [],
});

export const contractReviewFlowDiagram = flag<boolean>({
  key: "contract-review-flow-diagram",
  description: "Show the flow diagram above the Contract Review table",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

export const contractReviewExcelExport = flag<boolean>({
  key: "contract-review-excel-export",
  description: "Show the Export Excel button on the Contract Review table",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

export const contractReviewHiddenSidebar = flag<SidebarSection[]>({
  key: "contract-review-hidden-sidebar",
  description: "Contract Review sidebar blocks to hide",
  defaultValue: [],
  decide: () => [],
});
