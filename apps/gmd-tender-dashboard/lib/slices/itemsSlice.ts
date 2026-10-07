import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { ItemsModel } from "@/generated/prisma/models/Items";
import { getItems } from "@/actions/items";

export type ItemRow = ItemsModel & Record<string, unknown>;

interface ItemsState {
  rows: ItemRow[];
  loading: boolean;
  error: string | null;
}

const initialState: ItemsState = {
  rows: [],
  loading: false,
  error: null,
};

export const fetchItems = createAsyncThunk(
  "items/fetchAll",
  async () => await getItems(),
);

export const itemsSlice = createSlice({
  name: "items",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchItems.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchItems.fulfilled, (state, action) => {
        state.rows = action.payload;
        state.loading = false;
      })
      .addCase(fetchItems.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load items";
      });
  },
});

export default itemsSlice.reducer;