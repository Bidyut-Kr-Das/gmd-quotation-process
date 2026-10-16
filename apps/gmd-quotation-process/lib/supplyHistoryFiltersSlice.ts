import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface SupplyHistoryFiltersState {
  columnFilters: Record<string, string>;
  multiFilters: Record<string, string[]>;
  batchFilters: Record<string, boolean>;
  dateFrom: string;
  dateTo: string;
  globalSearch: string;
  currentPage: number;
  pageSize: number;
}

const initialState: SupplyHistoryFiltersState = {
  columnFilters: {},
  multiFilters: {},
  batchFilters: {},
  dateFrom: "",
  dateTo: "",
  globalSearch: "",
  currentPage: 1,
  pageSize: 25,
};

const supplyHistoryFiltersSlice = createSlice({
  name: "supplyHistoryFilters",
  initialState,
  reducers: {
    setColumnFilter(state, action: PayloadAction<{ header: string; value: string }>) {
      const { header, value } = action.payload;
      if (value) state.columnFilters[header] = value;
      else delete state.columnFilters[header];
    },
    setMultiFilter(state, action: PayloadAction<{ header: string; values: string[] }>) {
      const { header, values } = action.payload;
      if (values.length) state.multiFilters[header] = values;
      else delete state.multiFilters[header];
    },
    setBatchFilter(state, action: PayloadAction<{ key: string; value: boolean }>) {
      const { key, value } = action.payload;
      if (value) state.batchFilters[key] = true;
      else delete state.batchFilters[key];
    },
    setDateFrom(state, action: PayloadAction<string>) {
      state.dateFrom = action.payload;
    },
    setDateTo(state, action: PayloadAction<string>) {
      state.dateTo = action.payload;
    },
    setGlobalSearch(state, action: PayloadAction<string>) {
      state.globalSearch = action.payload;
    },
    setPage(state, action: PayloadAction<number>) {
      state.currentPage = action.payload;
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
    },
    resetFilters() {
      return initialState;
    },
  },
});

export const {
  setColumnFilter,
  setMultiFilter,
  setBatchFilter,
  setDateFrom,
  setDateTo,
  setGlobalSearch,
  setPage,
  setPageSize,
  resetFilters,
} = supplyHistoryFiltersSlice.actions;

export default supplyHistoryFiltersSlice.reducer;
