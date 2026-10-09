import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 160,  // Contract Review
  4: 130,  // Enquiry Type
  5: 200,  // State/Utility
  6: 210,  // Payment Terms / PBG / Inspection
  7: 200,  // Email Address
  8: 140,  // Contact No
  9: 130,  // Order Status
  10: 140, // Closure Status
  11: 160, // Project Reference
  12: 300, // Item Name As Per Party
  13: 400, // Details
  14: 110, // Quantity
  15: 140, // Item Code
  16: 140, // BOM ID
  17: 110, // Product Cost
  18: 120, // Cost Ref Code
  19: 130, // Cost
  20: 120, // Stock Status
  21: 120, // Stock Quantity
  22: 140, // Available Stock
  23: 140, // View Image
  24: 100, // Stock Against Contract
  25: 120, // Discount
  26: 150, // VA%
  27: 120, // Quoted Rate
  28: 140, // Rate (Contract Review)
  29: 140, // PD Cost Val
  30: 140, // QR incl. GST
  31: 240, // Item Name (Merge)
  32: 140, // Total Value incl. GST
  33: 140, // Itemwise Total Value
  34: 170, // Validation
  35: 140, // Delivery Schedule
  36: 170, // APM
  37: 150, // Offer PDF
  38: 80,  // Actions
};

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  generatedImages: {},
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleRow(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.expandedRows[id] === true) {
        state.expandedRows[id] = false;
      } else if (state.expandedRows[id] === false) {
        state.expandedRows[id] = true;
      } else {
        state.expandedRows[id] = true;
      }
    },
    setRowExpanded(
      state,
      action: PayloadAction<{ id: string; expanded: boolean }>
    ) {
      state.expandedRows[action.payload.id] = action.payload.expanded;
    },
    setExpandedRows(state, action: PayloadAction<Record<string, boolean>>) {
      state.expandedRows = { ...state.expandedRows, ...action.payload };
    },
    setColumnWidth(
      state,
      action: PayloadAction<{ index: number; width: number }>
    ) {
      state.columnWidths[action.payload.index] = action.payload.width;
    },
    toggleAnalyticsSidebar(state) {
      state.isAnalyticsSidebarCollapsed = !state.isAnalyticsSidebarCollapsed;
    },
    setAnalyticsSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.isAnalyticsSidebarCollapsed = action.payload;
    },
    setGeneratedImages(
      state,
      action: PayloadAction<Record<string, { url: string | null; driveFileId: string | null }>>
    ) {
      state.generatedImages = action.payload;
    },
  },
});

export const {
  toggleRow,
  setRowExpanded,
  setExpandedRows,
  setColumnWidth,
  toggleAnalyticsSidebar,
  setAnalyticsSidebarCollapsed,
  setGeneratedImages,
} = uiSlice.actions;

export default uiSlice.reducer;
