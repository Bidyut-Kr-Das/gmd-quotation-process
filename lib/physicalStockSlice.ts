import {
  createSlice,
  createEntityAdapter,
  createAsyncThunk,
} from "@reduxjs/toolkit";
import type { RootState } from "./store";
import {
  updatePhysicalStockFieldAction,
  updatePhysicalStockBomIdAction,
} from "@/app/physical_stock/actions";

export interface PhysicalStockRow {
  id: string;
  erp_code: string | null;
  location: string | null;
  l2_valve_type: string | null;
  dimension: string | null;
  l7_dimension: string | null;
  l4_component: string | null;
  l5_material: string | null;
  l6_std: string | null;
  l8_item_category: string | null;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
  remarks: string | null;
  sum_of_physical_stock: string | null;
  stock_as_per_erp: string | null;
  rate_unit: string | null;
  rate_per_pc_qty_weight: string | null;
  weight_per_pc: string | null;
  item_wise_value: string | null;
  moving_within_3_months: string | null;
  order_ag_approval_recvd: string | null;
  purchase_in_26_27: string | null;
  dispatched_in_26_27: string | null;
  order_in_hand_qty: string | null;
  shortage_qty: string | null;
  unnamed_aa: string | null;
  item_type: string | null;
  price: string | null;
  moq: string | null;
  if_less_than_moq_extra_charges: string | null;
  drawing_technical_data: string | null;
  cost: string | null;
  bom_id: string | null;
}

const adapter = createEntityAdapter<PhysicalStockRow>();

export const updatePhysicalStockField = createAsyncThunk(
  "physicalStock/updateField",
  async ({
    id,
    field,
    value,
  }: {
    id: string;
    field: string;
    value: string | null;
  }) => {
    return await updatePhysicalStockFieldAction(id, field, value);
  },
);

export const updatePhysicalStockBomId = createAsyncThunk(
  "physicalStock/updateBomId",
  async ({ id, bomId }: { id: string; bomId: string | null }) => {
    return await updatePhysicalStockBomIdAction(id, bomId);
  },
);

const physicalStockSlice = createSlice({
  name: "physicalStock",
  initialState: {
    ...adapter.getInitialState(),
    // Per-row BOM ID dropdown options, fetched alongside the rows.
    bomIdOptions: {} as Record<string, string[]>,
  },
  reducers: {
    hydratePhysicalStock(state, action) {
      adapter.setAll(state, action.payload);
    },
    upsertPhysicalStockItems(state, action) {
      adapter.upsertMany(state, action.payload);
    },
    setPhysicalStockBomIdOptions(
      state,
      action: { payload: Record<string, string[]> },
    ) {
      state.bomIdOptions = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(updatePhysicalStockField.fulfilled, (state, action) => {
      const { id, field, value } = action.payload;
      adapter.updateOne(state, { id, changes: { [field]: value } });
    });
    builder.addCase(updatePhysicalStockBomId.fulfilled, (state, action) => {
      const { id, bom_id, cost } = action.payload;
      adapter.updateOne(state, { id, changes: { bom_id, cost } });
    });
  },
});

export const {
  hydratePhysicalStock,
  upsertPhysicalStockItems,
  setPhysicalStockBomIdOptions,
} = physicalStockSlice.actions;
export const {
  selectAll: selectAllPhysicalStockRows,
  selectById: selectPhysicalStockRowById,
} = adapter.getSelectors<RootState>((state) => state.physicalStock);
export const selectPhysicalStockBomIdOptions = (state: RootState) =>
  state.physicalStock.bomIdOptions;
export default physicalStockSlice.reducer;
