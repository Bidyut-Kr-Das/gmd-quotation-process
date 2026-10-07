import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface BisStatusFiltersState {
  columnFilters: Record<string, string>;
  multiFilters: Record<string, string[]>;
  dateFrom: string;
  dateTo: string;
  globalSearch: string;
  currentPage: number;
  pageSize: number;
}

const initialState: BisStatusFiltersState = {
  columnFilters: {},
  multiFilters: {},
  dateFrom: "",
  dateTo: "",
  globalSearch: "",
  currentPage: 1,
  pageSize: 25,
};

const bisStatusFiltersSlice = createSlice({
  name: "bisStatusFilters",
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
  setDateFrom,
  setDateTo,
  setGlobalSearch,
  setPage,
  setPageSize,
  resetFilters,
} = bisStatusFiltersSlice.actions;

export default bisStatusFiltersSlice.reducer;
