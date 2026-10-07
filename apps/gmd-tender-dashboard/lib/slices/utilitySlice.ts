import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";

export type BomOption = {
  itemName: string | null;
  bomId: string;
  bomType: string | null;
  itemCode: string;
  itemScheduleName: string;
};

export type BomByItemName = Record<string, BomOption[]>;

interface UtilityState {
  bomByItemName: BomByItemName;
  bomTypesByItemName: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

const initialState: UtilityState = {
  bomByItemName: {},
  bomTypesByItemName: {},
  loading: false,
  error: null,
  loaded: false,
};

function buildTypesMap(bomByItemName: BomByItemName): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, arr] of Object.entries(bomByItemName)) {
    const types = Array.from(
      new Set(arr.map((r) => r.bomType).filter((v): v is string => v != null && String(v).trim() !== "").map((v) => String(v).trim()))
    ).sort();
    out[key] = types;
  }
  return out;
}

// GET /api/bom-options?names=...  (CSV or JSON)  or POST {itemNames}
export const fetchBomOptions = createAsyncThunk(
  "utility/fetchBomOptions",
  async (itemNames: string[] | undefined, { rejectWithValue }) => {
    try {
      // prefer POST for large payloads to avoid URL length limits
      if (itemNames && itemNames.length > 0) {
        // use POST when > 10 names or any name contains comma/newline
        const needsPost = itemNames.length > 20 || itemNames.some((n) => n.includes(",") || n.includes("\n"));
        if (needsPost) {
          const res = await fetch("/api/bom-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemNames }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to fetch bom options (${res.status})`);
          }
          const data = (await res.json()) as { bomByItemName: BomByItemName };
          return data.bomByItemName;
        }
      }

      const query =
        itemNames && itemNames.length > 0
          ? `?names=${encodeURIComponent(itemNames.join(","))}`
          : "";
      const res = await fetch(`/api/bom-options${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch bom options (${res.status})`);
      }
      const data = (await res.json()) as { bomByItemName: BomByItemName };
      return data.bomByItemName;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : "Failed to fetch bom options");
    }
  }
);

// convenience to fetch all (no filter)
export const fetchAllBomOptions = createAsyncThunk(
  "utility/fetchAllBomOptions",
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch("/api/bom-options");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch all bom options (${res.status})`);
      }
      const data = (await res.json()) as { bomByItemName: BomByItemName };
      return data.bomByItemName;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : "Failed to fetch all bom options");
    }
  }
);

export const utilitySlice = createSlice({
  name: "utility",
  initialState,
  reducers: {
    clearBomOptions(state) {
      state.bomByItemName = {};
      state.bomTypesByItemName = {};
      state.loaded = false;
      state.error = null;
    },
    setBomMap(state, action: PayloadAction<BomByItemName>) {
      state.bomByItemName = action.payload;
      state.bomTypesByItemName = buildTypesMap(action.payload);
      state.loaded = true;
    },
    mergeBomMap(state, action: PayloadAction<BomByItemName>) {
      const merged = { ...state.bomByItemName, ...action.payload };
      state.bomByItemName = merged;
      state.bomTypesByItemName = buildTypesMap(merged);
      state.loaded = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBomOptions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBomOptions.fulfilled, (state, action) => {
        state.loading = false;
        // merge to preserve previously fetched groups for incremental fetches
        const incoming = action.payload as BomByItemName;
        state.bomByItemName = { ...state.bomByItemName, ...incoming };
        state.bomTypesByItemName = buildTypesMap(state.bomByItemName);
        state.loaded = true;
      })
      .addCase(fetchBomOptions.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? action.error.message ?? "Failed to fetch";
      })
      .addCase(fetchAllBomOptions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllBomOptions.fulfilled, (state, action) => {
        state.loading = false;
        state.bomByItemName = action.payload as BomByItemName;
        state.bomTypesByItemName = buildTypesMap(action.payload as BomByItemName);
        state.loaded = true;
      })
      .addCase(fetchAllBomOptions.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? action.error.message ?? "Failed to fetch";
      });
  },
});

export const { clearBomOptions, setBomMap, mergeBomMap } = utilitySlice.actions;
export default utilitySlice.reducer;

// selectors helpers (usage: useAppSelector(s => selectBomOptionsForItem(s, itemName)))
export const selectBomOptionsForItem = (state: { utility: UtilityState }, itemName: string): BomOption[] => {
  if (!itemName) return [];
  // exact key first
  if (state.utility.bomByItemName[itemName]) return state.utility.bomByItemName[itemName];
  // fallback normalized (trim) lookup
  const norm = itemName.trim();
  if (state.utility.bomByItemName[norm]) return state.utility.bomByItemName[norm];
  // lower-case fallback
  const lower = norm.toLowerCase();
  for (const [k, v] of Object.entries(state.utility.bomByItemName)) {
    if (k.toLowerCase() === lower) return v;
  }
  return [];
};

export const selectBomTypesForItem = (state: { utility: UtilityState }, itemName: string): string[] => {
  if (!itemName) return [];
  if (state.utility.bomTypesByItemName[itemName]) return state.utility.bomTypesByItemName[itemName];
  const norm = itemName.trim();
  if (state.utility.bomTypesByItemName[norm]) return state.utility.bomTypesByItemName[norm];
  const lower = norm.toLowerCase();
  for (const [k, v] of Object.entries(state.utility.bomTypesByItemName)) {
    if (k.toLowerCase() === lower) return v;
  }
  return [];
};
