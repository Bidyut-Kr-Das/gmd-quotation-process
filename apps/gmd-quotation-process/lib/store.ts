import { configureStore } from "@reduxjs/toolkit";
import enquiriesReducer from "./enquiriesSlice";
import filtersReducer from "./filtersSlice";
import paginationReducer from "./paginationSlice";
import uiReducer from "./uiSlice";
import dialogsReducer from "./dialogsSlice";
import gmdUpdateReducer from "./gmdUpdateSlice";
import supplyHistoryFiltersReducer from "./supplyHistoryFiltersSlice";
import bisStatusFiltersReducer from "./bisStatusFiltersSlice";

export const makeStore = () => {
  return configureStore({
    reducer: {
      enquiries: enquiriesReducer,
      filters: filtersReducer,
      pagination: paginationReducer,
      ui: uiReducer,
      dialogs: dialogsReducer,
      gmdUpdate: gmdUpdateReducer,
      supplyHistoryFilters: supplyHistoryFiltersReducer,
      bisStatusFilters: bisStatusFiltersReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
