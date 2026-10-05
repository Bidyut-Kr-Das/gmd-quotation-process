import {
  createSlice,
  createEntityAdapter,
  createAsyncThunk,
} from "@reduxjs/toolkit";
import type { RootState } from "./store";
import {
  updateGMDUpdateFieldAction,
  updateGMDUsdCostAction,
  selectGMDUpdateBomIdAction,
  uploadGMDUpdateAttachmentAction,
  clearGMDUpdateAttachmentAction,
  deleteGMDUpdateTransferredAction,
} from "@/app/actions";

export interface GMDUpdateRow {
  id: string;
  erpItemCode: string | null;
  itemNameAuto: string | null;
  itemNameDerived: string | null;
  l1: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l7Dimension: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l8ItemCategory: string | null;
  um: string | null;
  conv1: string | null;
  pcsWgt: string | null;
  aum: string | null;
  availableStock: string | null;
  cost: number | null;
  usdRateOption: string | null;
  hsnCode: string | null;
  hsnCodeValidation: string | null;
  conv2: string | null;
  majorMarking: string | null;
  newItemStatus: string | null;
  currentStatus: string | null;
  rmType: string | null;
  indianImported: string | null;
  orderDelivery: string | null;
  bomId: string | null;
  vendorReference: string | null;
  attachmentUrl: string | null;
  /**
   * Hidden carrier for the "C" chip beside the item code. Appended after
   * dbItemToRow by the /raw_material route, so it is always the last column of
   * the payload and must be re-appended by any page that rebuilds rows.
   */
  cBatch: string | null;
}

const adapter = createEntityAdapter<GMDUpdateRow>();

export const updateGMDUpdateField = createAsyncThunk(
  "gmdUpdate/updateField",
  async ({
    id,
    field,
    value,
  }: {
    id: string;
    field: string;
    value: string | null;
  }) => {
    return await updateGMDUpdateFieldAction(id, field, value);
  },
);

export const updateGMDUsdCost = createAsyncThunk(
  "gmdUpdate/updateUsdCost",
  async ({ id, usdCost }: { id: string; usdCost: string | null }) => {
    const result = await updateGMDUsdCostAction(id, usdCost);
    if (!result.success) {
      throw new Error(result.error || "Failed to update USD cost.");
    }
    return result.data!;
  },
);

export const selectGMDUpdateBomId = createAsyncThunk(
  "gmdUpdate/selectBomId",
  async ({ id, bomId }: { id: string; bomId: string | null }) => {
    const result = await selectGMDUpdateBomIdAction(id, bomId);
    if (!result.success) {
      throw new Error(result.error || "Failed to select BOM ID.");
    }
    return result.data!;
  },
);

export const uploadGMDUpdateAttachment = createAsyncThunk(
  "gmdUpdate/uploadAttachment",
  async ({ id, file }: { id: string; file: File }) => {
    const result = await uploadGMDUpdateAttachmentAction(id, file);
    if (!result.success) {
      throw new Error(result.error || "Failed to upload attachment.");
    }
    return result.data!;
  },
);

export const clearGMDUpdateAttachment = createAsyncThunk(
  "gmdUpdate/clearAttachment",
  async ({ id }: { id: string }) => {
    const result = await clearGMDUpdateAttachmentAction(id);
    if (!result.success) {
      throw new Error(result.error || "Failed to clear attachment.");
    }
    return result.data!;
  },
);

export const deleteGMDUpdateTransferredItem = createAsyncThunk(
  "gmdUpdate/deleteTransferred",
  async ({ id }: { id: string }) => {
    const result = await deleteGMDUpdateTransferredAction(id);
    if (!result.success) {
      throw new Error(result.error || "Failed to delete item.");
    }
    return result.data!;
  },
);

const gmdUpdateSlice = createSlice({
  name: "gmdUpdate",
  initialState: adapter.getInitialState(),
  reducers: {
    hydrateGMDUpdate(state, action) {
      adapter.setAll(state, action.payload);
    },
    upsertGMDUpdateItems(state, action) {
      adapter.upsertMany(state, action.payload);
    },
    applyTransferCostMatch(
      state,
      action: {
        payload: {
          transferredRowId: string;
          newItemIds: string[];
          cost: number;
        };
        type: string;
      },
    ) {
      const { transferredRowId, newItemIds, cost } = action.payload;
      for (const id of newItemIds) {
        adapter.updateOne(state, { id, changes: { cost } });
      }
      adapter.updateOne(state, {
        id: transferredRowId,
        changes: {
          l1: null,
          l2ValveType: null,
          l3Dia: null,
          l7Dimension: null,
          l4Component: null,
          l5Material: null,
          l6Std: null,
          l8ItemCategory: null,
        },
      });
    },
  },
  extraReducers: (builder) => {
    builder.addCase(updateGMDUpdateField.fulfilled, (state, action) => {
      const { id, field, value } = action.payload;
      adapter.updateOne(state, { id, changes: { [field]: field === "cost" ? (value == null || value === "" ? null : Number(value)) : value } });
    });
    builder.addCase(updateGMDUsdCost.fulfilled, (state, action) => {
      const { id, usdCost, cost } = action.payload;
      adapter.updateOne(state, {
        id,
        changes: { usdRateOption: usdCost, cost },
      });
    });
    builder.addCase(selectGMDUpdateBomId.fulfilled, (state, action) => {
      const { id, bomId } = action.payload;
      adapter.updateOne(state, { id, changes: { bomId } });
    });
    builder.addCase(uploadGMDUpdateAttachment.fulfilled, (state, action) => {
      const { id, attachmentUrl } = action.payload;
      adapter.updateOne(state, { id, changes: { attachmentUrl } });
    });
    builder.addCase(clearGMDUpdateAttachment.fulfilled, (state, action) => {
      const { id, attachmentUrl } = action.payload;
      adapter.updateOne(state, { id, changes: { attachmentUrl } });
    });
    builder.addCase(deleteGMDUpdateTransferredItem.fulfilled, (state, action) => {
      const { id } = action.payload;
      adapter.removeOne(state, id);
    });
  },
});

export const { hydrateGMDUpdate, upsertGMDUpdateItems, applyTransferCostMatch } =
  gmdUpdateSlice.actions;
export const {
  selectAll: selectAllGMDUpdateRows,
  selectById: selectGMDUpdateRowById,
} = adapter.getSelectors<RootState>((state) => state.gmdUpdate);
export default gmdUpdateSlice.reducer;
