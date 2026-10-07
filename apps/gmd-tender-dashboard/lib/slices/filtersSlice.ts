import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { SortingState, ColumnSizingState, VisibilityState } from "@tanstack/react-table";
import type { ColumnFilterState, ColumnFilterType } from "@/lib/types";

type DeadlinePreset = "thisWeek" | "thisMonth" | "thisYear";

type ParticipationFilter = "participated" | "notParticipated" | "upcomingRa" | "participatedWithRa" | "participatedWithoutRa" | "yetToOpenRa" | "bidOpeningPendingExclRa" | "participatedTotal" | "raDone" | "raPending" | "technicalOpen" | "technicalNotOpen" | "weL1" | "weLost" | "expRaDate" | "contractReceived" | "contractPending" | "financialOpen" | "financialNotOpen" | "financialWeL1" | "financialWeLost" | "financialContractReceived" | "financialContractPending";
type AnalyticsFilter = "aiYes" | "aiYesUnallocated" | "apmYesAllocated" | "apmYesUnallocated" | null;

interface FiltersState {
  exclusionFilter: string | null;
  deadlinePreset: DeadlinePreset | null;
  deadlineDateFrom: string | null;
  deadlineDateTo: string | null;
  sorting: SortingState;
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
  typeFilter: "all" | "Gem" | "Non-Gem";
  aiRelevanceFilter: "all" | "yes" | "no" | "not_analysed";
  showFilterTray: boolean;
  columnFilters: Record<string, ColumnFilterState>;
  participationFilters: ParticipationFilter[];
  participatedDateRange: { from: string; to: string } | null;
  analyticsFilter: AnalyticsFilter;
}

const initialState: FiltersState = {
  exclusionFilter: null,
  deadlinePreset: null,
  deadlineDateFrom: null,
  deadlineDateTo: null,
  sorting: [],
  columnVisibility: {},
  columnSizing: {},
  typeFilter: "all",
  aiRelevanceFilter: "all",
  showFilterTray: false,
  columnFilters: {},
  participationFilters: [],
  participatedDateRange: { from: "2026-01-01", to: "" },
  analyticsFilter: null,
};

export const filtersSlice = createSlice({
  name: "filters",
  initialState,
  reducers: {
    setExclusionFilter(state, action: PayloadAction<string | null>) {
      state.exclusionFilter = action.payload;
    },
    setDeadlinePreset(state, action: PayloadAction<DeadlinePreset | null>) {
      state.deadlinePreset = action.payload;
      if (action.payload) {
        state.deadlineDateFrom = null;
        state.deadlineDateTo = null;
      }
    },
    setDeadlineDateRange(state, action: PayloadAction<{ from: string | null; to: string | null }>) {
      state.deadlineDateFrom = action.payload.from;
      state.deadlineDateTo = action.payload.to;
      if (action.payload.from) {
        state.deadlinePreset = null;
      }
    },
    clearDeadlineFilter(state) {
      state.deadlinePreset = null;
      state.deadlineDateFrom = null;
      state.deadlineDateTo = null;
    },
    setSorting(state, action: PayloadAction<SortingState>) {
      state.sorting = action.payload;
    },
    setColumnVisibility(state, action: PayloadAction<VisibilityState>) {
      state.columnVisibility = action.payload;
    },
    setColumnSizing(state, action: PayloadAction<ColumnSizingState>) {
      state.columnSizing = action.payload;
    },
    setTypeFilter(state, action: PayloadAction<"all" | "Gem" | "Non-Gem">) {
      state.typeFilter = action.payload;
    },
    setAiRelevanceFilter(state, action: PayloadAction<"all" | "yes" | "no" | "not_analysed">) {
      state.aiRelevanceFilter = action.payload;
    },
    toggleFilterTray(state) {
      state.showFilterTray = !state.showFilterTray;
    },
    setShowFilterTray(state, action: PayloadAction<boolean>) {
      state.showFilterTray = action.payload;
    },
    toggleParticipationFilter(state, action: PayloadAction<ParticipationFilter>) {
      const value = action.payload;
      const idx = state.participationFilters.indexOf(value);
      if (idx >= 0) {
        state.participationFilters.splice(idx, 1);
      } else {
        state.participationFilters.push(value);
      }
    },
    clearParticipationFilters(state) {
      state.participationFilters = [];
    },
    setAnalyticsFilter(state, action: PayloadAction<AnalyticsFilter>) {
      state.analyticsFilter = action.payload;
    },
    setParticipatedDateRange(
      state,
      action: PayloadAction<{ from: string; to: string }>,
    ) {
      state.participatedDateRange = action.payload;
    },
    clearParticipatedDateRange(state) {
      state.participatedDateRange = null;
    },
    setColumnFilter(state, action: PayloadAction<{ accessor: string; filterType: ColumnFilterType; value: unknown }>) {
      const { accessor, filterType, value } = action.payload;
      const currentFilter = state.columnFilters[accessor] || {};

      switch (filterType) {
        case "dateRange":
          state.columnFilters[accessor] = {
            ...currentFilter,
            dateRange: value as { startDate: string; endDate: string },
          };
          break;
        case "select":
          state.columnFilters[accessor] = {
            ...currentFilter,
            select: value as string[],
          };
          break;
        case "text":
          state.columnFilters[accessor] = {
            ...currentFilter,
            text: value as string,
          };
          break;
        case "boolean":
          state.columnFilters[accessor] = {
            ...currentFilter,
            boolean: value as boolean | null,
          };
          break;
        case "rawMaterials":
          state.columnFilters[accessor] = {
            ...currentFilter,
            rawMaterials: value as {
              aluMin: string;
              aluMax: string;
              cuMin: string;
              cuMax: string;
            },
          };
          break;
      }
    },
    clearColumnFilter(state, action: PayloadAction<{ accessor: string; filterType: ColumnFilterType }>) {
      const { accessor, filterType } = action.payload;
      const currentFilter = state.columnFilters[accessor];
      if (!currentFilter) return;

      switch (filterType) {
        case "dateRange":
          state.columnFilters[accessor] = { ...currentFilter, dateRange: undefined };
          break;
        case "select":
          state.columnFilters[accessor] = { ...currentFilter, select: undefined };
          break;
        case "text":
          state.columnFilters[accessor] = { ...currentFilter, text: undefined };
          break;
        case "boolean":
          state.columnFilters[accessor] = { ...currentFilter, boolean: undefined };
          break;
        case "rawMaterials":
          state.columnFilters[accessor] = { ...currentFilter, rawMaterials: undefined };
          break;
      }
    },
    resetColumnFilters(state) {
      state.columnFilters = {};
    },
    resetAllFilters(state) {
      state.exclusionFilter = null;
      state.deadlinePreset = null;
      state.deadlineDateFrom = null;
      state.deadlineDateTo = null;
      state.typeFilter = "all";
      state.aiRelevanceFilter = "all";
      state.participationFilters = [];
      state.participatedDateRange = null;
      state.analyticsFilter = null;
    },
  },
});

export const {
  setExclusionFilter,
  setDeadlinePreset,
  setDeadlineDateRange,
  clearDeadlineFilter,
  setSorting,
  setColumnVisibility,
  setColumnSizing,
  setTypeFilter,
  setAiRelevanceFilter,
  toggleFilterTray,
  setShowFilterTray,
  toggleParticipationFilter,
  clearParticipationFilters,
  setAnalyticsFilter,
  setParticipatedDateRange,
  clearParticipatedDateRange,
  setColumnFilter,
  clearColumnFilter,
  resetColumnFilters,
  resetAllFilters,
} = filtersSlice.actions;

export type { DeadlinePreset, ParticipationFilter, AnalyticsFilter };

export default filtersSlice.reducer;
