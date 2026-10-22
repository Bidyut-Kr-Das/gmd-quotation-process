import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import {
  fetchTenderFacet,
  fetchTenderSummary,
  fetchTendersPage,
  type TenderSummary,
} from "@/actions/tender-query";
import type { MergedGroup, TenderQuery } from "@/lib/tender-query";
import type { FlatRow } from "@/lib/tender-flatten";
import type { RootState } from "@/lib/store";

export interface TenderPageAssociation {
  id: number;
  name: string;
  email: string;
}

interface FacetEntry {
  options: string[];
  overLimit: boolean;
  status: "loading" | "ready" | "error";
  /** Query key the options were computed for, so stale caches are refetched. */
  queryKey: string;
}

interface TenderPageState {
  rows: FlatRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: { column: string; direction: "asc" | "desc" } | null;
  associationFilter: string | null;
  /** column_groups, loaded once per mount; the server needs them to filter
   *  and sort merged columns. */
  mergedGroups: MergedGroup[];
  columns: string[];
  associations: TenderPageAssociation[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** requestId of the newest dispatch; older responses are discarded. */
  pendingRequestId: string | null;
  facets: Record<string, FacetEntry>;
  summary: TenderSummary | null;
  /** Set by any tender mutation, so the page refetches instead of guessing. */
  stale: boolean;
}

const initialState: TenderPageState = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 50,
  sort: null,
  associationFilter: null,
  mergedGroups: [],
  columns: [],
  associations: [],
  status: "idle",
  error: null,
  pendingRequestId: null,
  facets: {},
  summary: null,
  stale: false,
};

/**
 * Stable key for a query. Keys are compared to skip redundant fetches and to
 * invalidate cached facet options, so the field order must not vary.
 */
export function tenderQueryKey(query: TenderQuery): string {
  return JSON.stringify({
    columnFilters: Object.keys(query.columnFilters)
      .sort()
      .map((k) => [k, query.columnFilters[k]]),
    participationFilters: [...query.participationFilters].sort(),
    analyticsFilter: query.analyticsFilter,
    exclusionFilter: query.exclusionFilter,
    associationFilter: query.associationFilter,
    fileDateFromIso: query.fileDateFromIso,
    fileDateToIso: query.fileDateToIso,
    applyDefaultDeadlineFilter: query.applyDefaultDeadlineFilter,
    mergedGroups: query.mergedGroups,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  });
}

/** Facet options only depend on the filters, never on the page or the sort. */
export function tenderFilterKey(query: TenderQuery): string {
  return tenderQueryKey({ ...query, page: 1, pageSize: 0, sort: null });
}

/**
 * Assembles the server query from the filter state the UI already keeps.
 * The file-date window is resolved to instants here, matching what
 * selectDateFilteredRows did in the browser.
 */
export function selectTenderQuery(
  state: RootState,
  applyDefaultDeadlineFilter: boolean,
): TenderQuery {
  const { filters, files, tenderPage } = state;

  let fileDateFromIso: string | null = null;
  let fileDateToIso: string | null = null;
  if (files.selectedDateFrom != null && files.selectedDateTo != null) {
    const to = new Date(files.selectedDateTo);
    to.setHours(23, 59, 59, 999);
    fileDateFromIso = new Date(files.selectedDateFrom).toISOString();
    fileDateToIso = to.toISOString();
  }

  return {
    columnFilters: filters.columnFilters,
    participationFilters: filters.participationFilters,
    analyticsFilter: filters.analyticsFilter,
    exclusionFilter: filters.exclusionFilter,
    associationFilter: tenderPage.associationFilter,
    fileDateFromIso,
    fileDateToIso,
    applyDefaultDeadlineFilter,
    mergedGroups: tenderPage.mergedGroups,
    sort: tenderPage.sort,
    page: tenderPage.page,
    pageSize: tenderPage.pageSize,
  };
}

/** Read-only thunks in the tenders slice; everything else mutates a row. */
const TENDERS_READ_ONLY = new Set([
  "tenders/fetchAllTenders",
  "tenders/fetchTendersIncremental",
  "tenders/appendTenders",
  "tenders/searchByParty",
]);

export const loadTenderPage = createAsyncThunk(
  "tenderPage/load",
  async (args: { query: TenderQuery; includeMeta: boolean }) =>
    fetchTendersPage(args.query, args.includeMeta),
);

export const loadTenderFacet = createAsyncThunk(
  "tenderPage/facet",
  async (args: { query: TenderQuery; column: string }) =>
    fetchTenderFacet(args.query, args.column),
  {
    condition: (args, { getState }) => {
      const state = getState() as RootState;
      const entry = state.tenderPage.facets[args.column];
      if (!entry) return true;
      // Already loading or already correct for this filter combination.
      return !(entry.queryKey === tenderFilterKey(args.query) && entry.status !== "error");
    },
  },
);

export const loadTenderSummary = createAsyncThunk(
  "tenderPage/summary",
  async (args: { query: TenderQuery }) => fetchTenderSummary(args.query),
);

export const tenderPageSlice = createSlice({
  name: "tenderPage",
  initialState,
  reducers: {
    setPage(state, action: PayloadAction<number>) {
      state.page = Math.max(1, action.payload);
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
      state.page = 1;
    },
    setSort(
      state,
      action: PayloadAction<{ column: string; direction: "asc" | "desc" } | null>,
    ) {
      state.sort = action.payload;
      state.page = 1;
    },
    setMergedGroups(state, action: PayloadAction<MergedGroup[]>) {
      state.mergedGroups = action.payload;
    },
    setAssociationFilter(state, action: PayloadAction<string | null>) {
      state.associationFilter = action.payload;
      state.page = 1;
    },
    /** Any filter change invalidates the page and every cached facet. */
    resetPagination(state) {
      state.page = 1;
      state.facets = {};
    },
    clearStale(state) {
      state.stale = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadTenderPage.pending, (state, action) => {
        state.status = "loading";
        state.error = null;
        state.pendingRequestId = action.meta.requestId;
      })
      .addCase(loadTenderPage.fulfilled, (state, action) => {
        // Server actions cannot be aborted, so late responses are dropped here.
        if (action.meta.requestId !== state.pendingRequestId) return;
        state.status = "ready";
        state.rows = action.payload.rows;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        if (action.payload.columns) state.columns = action.payload.columns;
        if (action.payload.associations) state.associations = action.payload.associations;
        state.pendingRequestId = null;
      })
      .addCase(loadTenderPage.rejected, (state, action) => {
        if (action.meta.requestId !== state.pendingRequestId) return;
        state.status = "error";
        state.error = action.error.message ?? "Failed to load tenders";
        state.pendingRequestId = null;
      })
      .addCase(loadTenderFacet.pending, (state, action) => {
        const { column, query } = action.meta.arg;
        state.facets[column] = {
          options: state.facets[column]?.options ?? [],
          overLimit: state.facets[column]?.overLimit ?? false,
          status: "loading",
          queryKey: tenderFilterKey(query),
        };
      })
      .addCase(loadTenderFacet.fulfilled, (state, action) => {
        const { column, query } = action.meta.arg;
        const queryKey = tenderFilterKey(query);
        // A newer filter combination already claimed this slot.
        if (state.facets[column] && state.facets[column].queryKey !== queryKey) return;
        state.facets[column] = {
          options: action.payload.options,
          overLimit: action.payload.overLimit,
          status: "ready",
          queryKey,
        };
      })
      .addCase(loadTenderSummary.fulfilled, (state, action) => {
        state.summary = action.payload;
      })
      .addCase(loadTenderFacet.rejected, (state, action) => {
        const { column, query } = action.meta.arg;
        state.facets[column] = {
          options: [],
          overLimit: false,
          status: "error",
          queryKey: tenderFilterKey(query),
        };
      })
      // Every mutating tenders/* thunk edits a row on the server. Rather than
      // mirroring a dozen optimistic reducers here, mark the page stale and
      // let the dashboard refetch it.
      .addMatcher(
        (action): action is { type: string } => {
          const type = (action as { type?: unknown }).type;
          if (typeof type !== "string") return false;
          if (!type.startsWith("tenders/") || !type.endsWith("/fulfilled")) return false;
          return !TENDERS_READ_ONLY.has(type.slice(0, type.lastIndexOf("/")));
        },
        (state) => {
          state.stale = true;
        },
      );
  },
});

export const {
  setPage,
  setPageSize,
  setSort,
  setMergedGroups,
  setAssociationFilter,
  resetPagination,
  clearStale,
} = tenderPageSlice.actions;

export default tenderPageSlice.reducer;
