import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PaginationState } from "./types";

const initialState: PaginationState = {
  currentPage: 1,
  pageSize: 10,
};

const paginationSlice = createSlice({
  name: "pagination",
  initialState,
  reducers: {
    setPage(state, action: PayloadAction<number>) {
      state.currentPage = action.payload;
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
    },
    resetPage(state) {
      state.currentPage = 1;
    },
  },
});

export const { setPage, setPageSize, resetPage } = paginationSlice.actions;

export default paginationSlice.reducer;
