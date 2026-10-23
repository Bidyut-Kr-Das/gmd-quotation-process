import type { EnquiryData, FiltersState } from "./types";
import { initialFiltersState } from "./filtersSlice";

/** Sort requested by the table header. `null` = newest first, like today. */
export type EnquirySort = { field: string; direction: "asc" | "desc" } | null;

/**
 * Everything the quotation dashboard needs to load one page of enquiries.
 * `filters` is the same serializable object the client already keeps.
 */
export interface EnquiryQuery {
  filters: FiltersState;
  globalSearch: string;
  projectReference: string;
  pendingOnly: boolean;
  closedBomOnly: boolean;
  selectedEnquiryIds: string[];
  sort: EnquirySort;
  page: number;
  pageSize: number;
}

export interface ClosureCounts {
  [status: string]: number;
}

export interface EnquirySummary {
  filteredEnquiries: number;
  analyticsItems: number;
  totalValueGst: number;
  totalValueExclGst: number;
  totalCost: number;
  totalQuantity: number;
  closureCounts: ClosureCounts;
  notSentCount: number;
  totalEnquiries: number;
}

export interface EnquiryPageResult {
  enquiries: EnquiryData[];
  total: number;
  /** Null when the request only paged/sorted; the previous totals still stand. */
  summary: EnquirySummary | null;
}

export const EMPTY_ENQUIRY_SUMMARY: EnquirySummary = {
  filteredEnquiries: 0,
  analyticsItems: 0,
  totalValueGst: 0,
  totalValueExclGst: 0,
  totalCost: 0,
  totalQuantity: 0,
  closureCounts: {},
  notSentCount: 0,
  totalEnquiries: 0,
};

export interface EnquiryFacetResult {
  field: string;
  options: string[];
}

export interface FilteredIds {
  enquiryIds: string[];
  itemIds: string[];
}

export function emptyEnquiryQuery(): EnquiryQuery {
  return {
    filters: initialFiltersState,
    globalSearch: "",
    projectReference: "",
    pendingOnly: false,
    closedBomOnly: false,
    selectedEnquiryIds: [],
    sort: null,
    page: 1,
    pageSize: 10,
  };
}

/** Stable key so the page only reloads when something the server cares about changed. */export function enquiryQueryKey(q: EnquiryQuery): string {
  return JSON.stringify({
    filters: Object.entries(q.filters)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, v]),
    globalSearch: q.globalSearch,
    projectReference: q.projectReference,
    pendingOnly: q.pendingOnly,
    closedBomOnly: q.closedBomOnly,
    selectedEnquiryIds: [...q.selectedEnquiryIds].sort(),
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });
}

/** Facet options only depend on the filters, never on the page or the sort. */
export function enquiryFilterKey(q: EnquiryQuery): string {
  return enquiryQueryKey({ ...q, page: 1, pageSize: 0, sort: null });
}
