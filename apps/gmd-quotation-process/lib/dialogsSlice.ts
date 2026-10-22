import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DialogsState } from "./types";

const initialState: DialogsState = {
  isAddItemsOpen: false,
  isNewEnquiryOpen: false,
  viewItemId: null,
  editItemId: null,
  deleteItemId: null,
};

const dialogsSlice = createSlice({
  name: "dialogs",
  initialState,
  reducers: {
    openAddItemsDialog(state) {
      state.isAddItemsOpen = true;
    },
    closeAddItemsDialog(state) {
      state.isAddItemsOpen = false;
    },
    openNewEnquiryDialog(state) {
      state.isNewEnquiryOpen = true;
    },
    closeNewEnquiryDialog(state) {
      state.isNewEnquiryOpen = false;
    },
    openViewDialog(state, action: PayloadAction<string>) {
      state.viewItemId = action.payload;
    },
    closeViewDialog(state) {
      state.viewItemId = null;
    },
    openEditDialog(state, action: PayloadAction<string>) {
      state.editItemId = action.payload;
    },
    closeEditDialog(state) {
      state.editItemId = null;
    },
    openDeleteDialog(state, action: PayloadAction<string>) {
      state.deleteItemId = action.payload;
    },
    closeDeleteDialog(state) {
      state.deleteItemId = null;
    },
  },
});

export const {
  openAddItemsDialog,
  closeAddItemsDialog,
  openNewEnquiryDialog,
  closeNewEnquiryDialog,
  openViewDialog,
  closeViewDialog,
  openEditDialog,
  closeEditDialog,
  openDeleteDialog,
  closeDeleteDialog,
} = dialogsSlice.actions;

export default dialogsSlice.reducer;
