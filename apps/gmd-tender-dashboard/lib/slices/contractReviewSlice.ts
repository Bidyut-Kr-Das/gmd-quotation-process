import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import {
  getContractReviewPage,
  getContractReviewFacet,
  updateContractReviewRemarks as updateContractReviewRemarksAction,
  updateContractReviewDiagramVerdict as updateContractReviewDiagramVerdictAction,
  updateContractReviewItem as updateContractReviewItemAction,
  createContractReviewDiagramUploadUrl as createContractReviewDiagramUploadUrlAction,
  confirmContractReviewDiagramUpload as confirmContractReviewDiagramUploadAction,
  type ContractReviewRow,
  type ContractReviewSort,
  type ContractReviewFilters,
  type ContractReviewSearch,
  type DiagramVerdict,
} from "@/actions/contract-review";

interface FacetEntry {
  options: string[];
  overLimit: boolean;
  hasBlank: boolean;
  status: "loading" | "ready" | "error";
  /** Filter combination the options were computed for. */
  queryKey: string;
}

interface ContractReviewState {
  rows: ContractReviewRow[];
  total: number;
  quantity: number;
  page: number;
  pageSize: number;
  sort: ContractReviewSort;
  filters: ContractReviewFilters;
  searches: ContractReviewSearch;
  facets: Record<string, FacetEntry>;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** Cell-level flags for in-flight remarks edits, keyed by row id. */
  remarksUpdating: Record<string, boolean>;
  /** Cell-level flags for in-flight verdict/diagram edits, keyed by row id. */
  verdictUpdating: Record<string, boolean>;
  /** Cell-level flags for in-flight item edits, keyed by row id. */
  itemUpdating: Record<string, boolean>;
  /** requestId of the newest dispatch; older responses are discarded. */
  pendingRequestId: string | null;
}

const initialState: ContractReviewState = {
  rows: [],
  total: 0,
  quantity: 0,
  page: 1,
  pageSize: 50,
  sort: null,
  filters: {},
  searches: {},
  facets: {},
  status: "idle",
  error: null,
  remarksUpdating: {},
  verdictUpdating: {},
  itemUpdating: {},
  pendingRequestId: null,
};

export function contractReviewFilterKey(
  filters: ContractReviewFilters,
  searches: ContractReviewSearch,
): string {
  return JSON.stringify([
    Object.keys(filters)
      .sort()
      .map((k) => [k, filters[k]]),
    Object.keys(searches)
      .sort()
      .map((k) => [k, searches[k]]),
  ]);
}

export const loadContractReviewPage = createAsyncThunk(
  "contractReview/load",
  async (args: {
    page: number;
    pageSize: number;
    sort: ContractReviewSort;
    filters: ContractReviewFilters;
    search: ContractReviewSearch;
  }) => getContractReviewPage(args),
);

export const loadContractReviewFacet = createAsyncThunk(
  "contractReview/facet",
  async (args: {
    column: string;
    filters: ContractReviewFilters;
    search: ContractReviewSearch;
  }) => getContractReviewFacet(args),
  {
    condition: (args, { getState }) => {
      const state = (getState() as { contractReview: ContractReviewState })
        .contractReview;
      const entry = state.facets[args.column];
      if (!entry) return true;
      return !(
        entry.queryKey ===
          contractReviewFilterKey(args.filters, args.search) &&
        entry.status !== "error"
      );
    },
  },
);

export const updateContractReviewRemarks = createAsyncThunk(
  "contractReview/updateRemarks",
  async (args: { id: string; remarks: string | null }) => {
    await updateContractReviewRemarksAction(args);
    return args;
  },
);

export const updateContractReviewVerdict = createAsyncThunk(
  "contractReview/updateVerdict",
  async (args: { id: string; verdict: DiagramVerdict }) => {
    await updateContractReviewDiagramVerdictAction(args);
    return args;
  },
);

export const updateContractReviewItem = createAsyncThunk(
  "contractReview/updateItem",
  async (args: { id: string; item: string | null }) => {
    const result = await updateContractReviewItemAction(args);
    return { id: args.id, item: result.item };
  },
);

export const uploadContractReviewDiagram = createAsyncThunk(
  "contractReview/uploadDiagram",
  async (formData: FormData) => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("No file provided");
    const id = String(formData.get("id") ?? "");

    const meta = new FormData();
    meta.append("id", id);
    meta.append("fileName", file.name);
    meta.append("contentType", file.type);
    const { uploadUrl, publicUrl } =
      await createContractReviewDiagramUploadUrlAction(meta);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);

    const result = await confirmContractReviewDiagramUploadAction({
      id,
      url: publicUrl,
    });
    return { id, url: result.url };
  },
);

export const contractReviewSlice = createSlice({
  name: "contractReview",
  initialState,
  reducers: {
    setPage(state, action: PayloadAction<number>) {
      state.page = Math.max(1, action.payload);
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
      state.page = 1;
    },
    setSort(state, action: PayloadAction<ContractReviewSort>) {
      state.sort = action.payload;
      state.page = 1;
    },
    toggleFilter(
      state,
      action: PayloadAction<{ column: string; value: string }>,
    ) {
      const { column, value } = action.payload;
      const current = state.filters[column] ?? [];
      state.filters[column] = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      state.page = 1;
    },
    clearFilter(state, action: PayloadAction<string>) {
      delete state.filters[action.payload];
      state.page = 1;
    },
    clearAllFilters(state) {
      state.filters = {};
      state.searches = {};
      state.facets = {};
      state.page = 1;
    },
    setColumnSearch(
      state,
      action: PayloadAction<{ accessor: string; value: string }>,
    ) {
      const { accessor, value } = action.payload;
      if (value.trim() === "") delete state.searches[accessor];
      else state.searches[accessor] = value.trim();
      state.page = 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadContractReviewPage.pending, (state, action) => {
        state.status = "loading";
        state.error = null;
        state.pendingRequestId = action.meta.requestId;
      })
      .addCase(loadContractReviewPage.fulfilled, (state, action) => {
        // Server actions cannot be aborted, so late responses are dropped.
        if (action.meta.requestId !== state.pendingRequestId) return;
        state.status = "ready";
        state.rows = action.payload.rows;
        state.total = action.payload.total;
        state.quantity = action.payload.quantity;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.pendingRequestId = null;
      })
      .addCase(loadContractReviewPage.rejected, (state, action) => {
        if (action.meta.requestId !== state.pendingRequestId) return;
        state.status = "error";
        state.error = action.error.message ?? "Failed to load contract review";
        state.pendingRequestId = null;
      })
      .addCase(loadContractReviewFacet.pending, (state, action) => {
        const { column, filters, search } = action.meta.arg;
        state.facets[column] = {
          options: state.facets[column]?.options ?? [],
          overLimit: state.facets[column]?.overLimit ?? false,
          hasBlank: state.facets[column]?.hasBlank ?? false,
          status: "loading",
          queryKey: contractReviewFilterKey(filters, search),
        };
      })
      .addCase(loadContractReviewFacet.fulfilled, (state, action) => {
        const { column, filters, search } = action.meta.arg;
        const queryKey = contractReviewFilterKey(filters, search);
        // A newer filter combination already claimed this slot.
        if (state.facets[column] && state.facets[column].queryKey !== queryKey) {
          return;
        }
        state.facets[column] = {
          options: action.payload.options,
          overLimit: action.payload.overLimit,
          hasBlank: action.payload.hasBlank,
          status: "ready",
          queryKey,
        };
      })
      .addCase(loadContractReviewFacet.rejected, (state, action) => {
        const { column, filters, search } = action.meta.arg;
        state.facets[column] = {
          options: [],
          overLimit: false,
          hasBlank: false,
          status: "error",
          queryKey: contractReviewFilterKey(filters, search),
        };
      })
      .addCase(updateContractReviewRemarks.pending, (state, action) => {
        state.remarksUpdating[action.meta.arg.id] = true;
      })
      .addCase(updateContractReviewRemarks.fulfilled, (state, action) => {
        const { id, remarks } = action.payload;
        delete state.remarksUpdating[id];
        const row = state.rows.find((r) => r.id === id);
        if (row) row.remarks = remarks;
      })
      .addCase(updateContractReviewRemarks.rejected, (state, action) => {
        delete state.remarksUpdating[action.meta.arg.id];
      })
      .addCase(updateContractReviewVerdict.pending, (state, action) => {
        state.verdictUpdating[action.meta.arg.id] = true;
      })
      .addCase(updateContractReviewVerdict.fulfilled, (state, action) => {
        const { id, verdict } = action.payload;
        delete state.verdictUpdating[id];
        const row = state.rows.find((r) => r.id === id);
        if (row) row.diagramVerdict = verdict;
      })
      .addCase(updateContractReviewVerdict.rejected, (state, action) => {
        delete state.verdictUpdating[action.meta.arg.id];
      })
      .addCase(updateContractReviewItem.pending, (state, action) => {
        state.itemUpdating[action.meta.arg.id] = true;
      })
      .addCase(updateContractReviewItem.fulfilled, (state, action) => {
        const { id, item } = action.payload;
        delete state.itemUpdating[id];
        const row = state.rows.find((r) => r.id === id);
        if (row) row.item = item;
      })
      .addCase(updateContractReviewItem.rejected, (state, action) => {
        delete state.itemUpdating[action.meta.arg.id];
      })
      .addCase(uploadContractReviewDiagram.pending, (state, action) => {
        const id = String(action.meta.arg.get("id") ?? "");
        state.verdictUpdating[id] = true;
      })
      .addCase(uploadContractReviewDiagram.fulfilled, (state, action) => {
        const { id, url } = action.payload;
        delete state.verdictUpdating[id];
        const row = state.rows.find((r) => r.id === id);
        if (row) row.diagramUrl = url;
      })
      .addCase(uploadContractReviewDiagram.rejected, (state, action) => {
        const id = String(action.meta.arg.get("id") ?? "");
        delete state.verdictUpdating[id];
      });
  },
});

export const {
  setPage,
  setPageSize,
  setSort,
  toggleFilter,
  clearFilter,
  clearAllFilters,
  setColumnSearch,
} = contractReviewSlice.actions;

export default contractReviewSlice.reducer;