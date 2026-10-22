import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export interface CredentialRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  category: string | null;
  websites: string | null;
  states: string | null;
  userId: string | null;
  password: string | null;
  mobileNo: string | null;
  profilePassword: string | null;
  dscName: string | null;
  dscPassword: string | null;
  otherRef: string | null;
}

interface CredentialsState {
  data: CredentialRecord[];
  /** Blocking load - only true when there is nothing to show yet. */
  loading: boolean;
  /** Background revalidation of data already on screen. */
  refreshing: boolean;
  error: string | null;
  updating: Record<string, boolean>;
  creating: boolean;
  /** Epoch ms of the last successful fetch, used to decide staleness. */
  lastFetched: number | null;
}

const initialState: CredentialsState = {
  data: [],
  loading: false,
  refreshing: false,
  error: null,
  updating: {},
  creating: false,
  lastFetched: null,
};

/** How long a fetched list is considered fresh enough to skip a refetch. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export const fetchCredentials = createAsyncThunk<
  CredentialRecord[],
  { force?: boolean } | undefined,
  { state: { credentials: CredentialsState } }
>(
  "credentials/fetchAll",
  async (_arg, { rejectWithValue }) => {
    try {
      const res = await fetch("/api/credentials");
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Server error (${res.status})`);
      return json.data as CredentialRecord[];
    } catch (err: any) {
      return rejectWithValue(err.message || "Failed to fetch credentials");
    }
  },
  {
    // Skip the request entirely when a fresh list is already in the store, so
    // navigating back to /credentials renders instantly instead of refetching
    // and flashing a spinner. Explicit refreshes pass { force: true }.
    condition: (arg, { getState }) => {
      const state = getState().credentials;
      if (state.loading || state.refreshing) return false;
      if (arg?.force) return true;
      if (state.data.length === 0 || state.lastFetched === null) return true;
      return Date.now() - state.lastFetched > STALE_AFTER_MS;
    },
  },
);

export const createCredential = createAsyncThunk(
  "credentials/create",
  async (payload: Record<string, string | null>, { rejectWithValue }) => {
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to create");
      return json.data as CredentialRecord;
    } catch (err: any) {
      return rejectWithValue(err.message || "Failed to create credential");
    }
  },
);

export const updateCredential = createAsyncThunk(
  "credentials/update",
  async (params: { id: string; field: string; value: string | null }, { rejectWithValue }) => {
    try {
      const res = await fetch(`/api/credentials/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [params.field]: params.value }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to update");
      return json.data as CredentialRecord;
    } catch (err: any) {
      return rejectWithValue(err.message || "Failed to update credential");
    }
  },
);

export const deleteCredential = createAsyncThunk(
  "credentials/delete",
  async (id: string, { rejectWithValue }) => {
    try {
      const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to delete");
      return id;
    } catch (err: any) {
      return rejectWithValue(err.message || "Failed to delete credential");
    }
  },
);

export const credentialsSlice = createSlice({
  name: "credentials",
  initialState,
  reducers: {
    clearCredentialsError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCredentials.pending, (state) => {
        // Only block the page when there is nothing cached to show.
        if (state.data.length === 0) state.loading = true;
        else state.refreshing = true;
        state.error = null;
      })
      .addCase(fetchCredentials.fulfilled, (state, action) => {
        state.loading = false;
        state.refreshing = false;
        state.data = action.payload;
        state.lastFetched = Date.now();
      })
      .addCase(fetchCredentials.rejected, (state, action) => {
        state.loading = false;
        state.refreshing = false;
        state.error = (action.payload as string) || "Failed to fetch";
      })
      .addCase(createCredential.pending, (state) => {
        state.creating = true;
        state.error = null;
      })
      .addCase(createCredential.fulfilled, (state, action) => {
        state.creating = false;
        state.data.unshift(action.payload);
      })
      .addCase(createCredential.rejected, (state, action) => {
        state.creating = false;
        state.error = (action.payload as string) || "Failed to create";
      })
      .addCase(updateCredential.pending, (state, action) => {
        const { id, field } = action.meta.arg;
        state.updating[`${id}-${field}`] = true;
      })
      .addCase(updateCredential.fulfilled, (state, action) => {
        const record = action.payload;
        const { id, field } = action.meta.arg;
        state.updating[`${id}-${field}`] = false;
        const idx = state.data.findIndex((r) => r.id === record.id);
        if (idx !== -1) state.data[idx] = record;
      })
      .addCase(updateCredential.rejected, (state, action) => {
        const { id, field } = action.meta.arg;
        state.updating[`${id}-${field}`] = false;
        state.error = (action.payload as string) || "Failed to update";
      })
      .addCase(deleteCredential.pending, (state, action) => {
        const id = action.meta.arg;
        state.updating[`${id}-delete`] = true;
      })
      .addCase(deleteCredential.fulfilled, (state, action) => {
        const id = action.payload;
        state.updating[`${id}-delete`] = false;
        state.data = state.data.filter((r) => r.id !== id);
      })
      .addCase(deleteCredential.rejected, (state, action) => {
        const id = action.meta.arg;
        state.updating[`${id}-delete`] = false;
        state.error = (action.payload as string) || "Failed to delete";
      });
  },
});

export const { clearCredentialsError } = credentialsSlice.actions;
export default credentialsSlice.reducer;
