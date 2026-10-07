import { configureStore } from "@reduxjs/toolkit";
import filesReducer from "@/lib/slices/filesSlice";
import tendersReducer from "@/lib/slices/tendersSlice";
import uploadReducer from "@/lib/slices/uploadSlice";
import filtersReducer from "@/lib/slices/filtersSlice";
import utilityReducer from "@/lib/slices/utilitySlice";
import credentialsReducer from "@/lib/slices/credentialsSlice";
import emdReducer from "@/lib/slices/emdSlice";
import railwaysReducer from "@/lib/slices/railwaysSlice";
import itemsReducer from "@/lib/slices/itemsSlice";
import tenderPageReducer from "@/lib/slices/tenderPageSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      files: filesReducer,
      tenders: tendersReducer,
      upload: uploadReducer,
      filters: filtersReducer,
      utility: utilityReducer,
      credentials: credentialsReducer,
      emd: emdReducer,
      railways: railwaysReducer,
      items: itemsReducer,
      tenderPage: tenderPageReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // Both checks walk the entire state tree on every dispatch. With ~34k
        // tender rows that is millions of nodes per action in development.
        serializableCheck: false,
        immutableCheck: false,
      }),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
