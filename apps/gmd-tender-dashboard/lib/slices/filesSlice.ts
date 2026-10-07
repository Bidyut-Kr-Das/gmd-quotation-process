import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { subDays } from "date-fns";

interface FileItem {
  id: number;
  fileName: string;
  totalCount: number | null;
  excludedCount: number | null;
  status: string | null;
  updatedAt: string;
}

interface FilesState {
  selectedDateFrom: string | null;
  selectedDateTo: string | null;
  items: FileItem[];
  loading: boolean;
}

function todayString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function twoDaysAgoString(): string {
  const d = subDays(new Date(), 2);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const initialState: FilesState = {
  selectedDateFrom: "2026-01-01T00:00:00.000Z",
  selectedDateTo: todayString(),
  items: [],
  loading: false,
};

export const fetchFiles = createAsyncThunk(
  "files/fetchFiles",
  async () => {
    const res = await fetch("/api/files");
    if (!res.ok) {
      throw new Error("Failed to fetch files");
    }
    const data = await res.json();
    return data.files as FileItem[];
  },
);

export const filesSlice = createSlice({
  name: "files",
  initialState,
  reducers: {
    setSelectedDateRange(state, action) {
      state.selectedDateFrom = action.payload.from;
      state.selectedDateTo = action.payload.to;
    },
    resetSelectedDateRange(state) {
      state.selectedDateFrom = null;
      state.selectedDateTo = null;
    },
    clearState() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFiles.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchFiles.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchFiles.rejected, (state) => {
        state.loading = false;
      });
  },
});

export const { setSelectedDateRange, resetSelectedDateRange, clearState } =
  filesSlice.actions;
export default filesSlice.reducer;
