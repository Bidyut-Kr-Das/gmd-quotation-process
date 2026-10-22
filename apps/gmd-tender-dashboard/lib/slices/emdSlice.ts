import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export interface EmdMergedRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  emdType: "CASH" | "BG" | null;
  tenderNo: string | null;
  tmNo: string | null;
  remarks: string | null;
  contactEmailId: string | null;
  emailDraft: string | null;
  lastEmailSent: string | null;
  lastEmailSentAt: string | null;
  reason: string | null;
  contactNo: string | null;
  address: string | null;
  docketNo: string | null;
  bgNo: string | null;
  customerName: string | null;
  emdAmt: string | null;
  bgAmtLocal: string | null;
  bgAmtFc: string | null;
  issueDt: string | null;
  bgDate: string | null;
  expectedRefundDateOrRefundedDate: string | null;
  expiryDate: string | null;
  claimDate: string | null;
  trantype: string | null;
  bankName: string | null;
  partyCode: string | null;
  staffName: string | null;
  status: string | null;
  match: string | null;
  bgMatch: string | null;
  statusPriceAssDone: string | null;
  permanent: string | null;
  chDdNo: string | null;
  acHolder: string | null;
  statusAsPerSujibDaAndOther: string | null;
  canBeRefunded: string | null;
  rank: string | null;
  poIssueStatus: string | null;
  aocAwardOfContractStatus: string | null;
  refundableOrNot: string | null;
  statusRefundedPending: string | null;
  statusOfTender: string | null;
  conditionsForRefund: string | null;
  certificateByParty: string | null;
  certificateByUtility: string | null;
  tenderMergeds?: { id: number; docketNo: string | null }[];
}

/** Fields the table can edit inline. */
export type EmdEditableField =
  | "reason"
  | "status"
  | "contactEmailId"
  | "contactNo"
  | "remarks"
  | "tmNo"
  | "docketNo"
  | "bgNo";

interface EmdState {
  data: EmdMergedRecord[];
  /** Blocking load - only true when there is nothing cached to show yet. */
  loading: boolean;
  /** Background revalidation while cached rows stay on screen. */
  refreshing: boolean;
  error: string | null;
  /** In-flight field saves, keyed `${id}:${field}`. */
  updating: Record<string, boolean>;
  /** Pre-edit values, held only while a save is in flight, for rollback. */
  rollback: Record<string, string | null>;
  /** Epoch ms of the last successful fetch, used to decide staleness. */
  lastFetched: number | null;
}

const initialState: EmdState = {
  data: [],
  loading: false,
  refreshing: false,
  error: null,
  updating: {},
  rollback: {},
  lastFetched: null,
};

/** How long the fetched list is considered fresh enough to skip a refetch. */
const STALE_AFTER_MS = 5 * 60 * 1000;

const key = (id: string, field: string) => `${id}:${field}`;

export const fetchEmdMerged = createAsyncThunk<
  EmdMergedRecord[],
  { force?: boolean } | undefined,
  { state: { emd: EmdState }; rejectValue: string }
>(
  "emd/fetchAll",
  async (_arg, { rejectWithValue, signal }) => {
    try {
      const res = await fetch("/api/emd", { signal });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Server error (${res.status})`);
      }
      return (json.data || []) as EmdMergedRecord[];
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return rejectWithValue("aborted");
      }
      const message =
        err instanceof Error ? err.message : "Failed to fetch EMD records";
      return rejectWithValue(message);
    }
  },
  {
    // Skip the request when a fresh list is already in the store, so navigating
    // back to /emd paints immediately instead of refetching behind a spinner.
    condition: (arg, { getState }) => {
      const state = getState().emd;
      if (state.loading || state.refreshing) return false;
      if (arg?.force) return true;
      if (state.data.length === 0 || state.lastFetched === null) return true;
      return Date.now() - state.lastFetched > STALE_AFTER_MS;
    },
  },
);

/**
 * Optimistic single-field save. The reducers below apply the new value on
 * pending and restore the captured previous value if the request fails, so the
 * page no longer hand-rolls an overlay map and manual rollback per field.
 */
export const updateEmdField = createAsyncThunk<
  { id: string; field: EmdEditableField; value: string | null },
  { id: string; field: EmdEditableField; value: string | null },
  { rejectValue: string }
>("emd/updateField", async ({ id, field, value }, { rejectWithValue }) => {
  try {
    const res = await fetch(`/api/emd/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || "Failed");
    return { id, field, value };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update";
    return rejectWithValue(message);
  }
});

export const emdSlice = createSlice({
  name: "emd",
  initialState,
  reducers: {
    clearEmdError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmdMerged.pending, (state) => {
        // Only block the page when there is nothing cached to show.
        if (state.data.length === 0) state.loading = true;
        else state.refreshing = true;
        state.error = null;
      })
      .addCase(fetchEmdMerged.fulfilled, (state, action) => {
        state.loading = false;
        state.refreshing = false;
        state.data = action.payload;
        state.lastFetched = Date.now();
      })
      .addCase(fetchEmdMerged.rejected, (state, action) => {
        state.loading = false;
        state.refreshing = false;
        if (action.payload !== "aborted") {
          state.error = action.payload || "Failed to fetch EMD records";
        }
      })
      .addCase(updateEmdField.pending, (state, action) => {
        const { id, field, value } = action.meta.arg;
        const k = key(id, field);
        const row = state.data.find((r) => r.id === id);
        if (!row) return;
        state.rollback[k] = row[field] ?? null;
        row[field] = value;
        state.updating[k] = true;
      })
      .addCase(updateEmdField.fulfilled, (state, action) => {
        const { id, field } = action.payload;
        const k = key(id, field);
        delete state.updating[k];
        delete state.rollback[k];
      })
      .addCase(updateEmdField.rejected, (state, action) => {
        const { id, field } = action.meta.arg;
        const k = key(id, field);
        const row = state.data.find((r) => r.id === id);
        if (row && k in state.rollback) row[field] = state.rollback[k];
        delete state.updating[k];
        delete state.rollback[k];
      });
  },
});

export const { clearEmdError } = emdSlice.actions;
export default emdSlice.reducer;
