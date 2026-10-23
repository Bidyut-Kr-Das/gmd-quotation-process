"use client";

import { useCallback, useMemo, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable, {
  type ServerTableMode,
} from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  updateSupplyHistoryFieldAction,
  updateSupplyHistorySelectedBomAction,
  updateSupplyHistoryBomCostAction,
} from "@/app/actions";
import {
  fetchAllSupplyRows,
  fetchSupplyFacet,
  fetchSupplyPage,
  type SupplyPageResult,
} from "@/app/actions/supplyQuery";
import { SUPPLY_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/supply-history-columns";
import {
  C_BATCH_HEADER,
  cBatchBadges,
  cBatchFilter,
} from "@/lib/gmd_lib/verify-bom-columns";
import { SUPPLY_DISPLAY_HEADERS } from "@/lib/supplyDisplay";
import { INDIAN_STATES } from "@/lib/supplyStateResolver";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  setColumnFilter,
  setMultiFilter,
  setBatchFilter,
  setDateFrom,
  setDateTo,
  setGlobalSearch,
  setPage,
  setPageSize,
  resetFilters,
} from "@/lib/supplyHistoryFiltersSlice";
import { useServerTable } from "@/lib/useServerTable";
import type { SupplyQuery } from "@/lib/supplyQuery";
import type { TableSort } from "@/lib/tableQuery";

// Stable descriptor so the shared table's row predicate keeps a stable dep.
const SUPPLY_HISTORY_BATCH_FILTERS = [cBatchFilter()];

export default function SupplyHistoryPage() {
  const dispatch = useAppDispatch();
  const filterState = useAppSelector((s) => s.supplyHistoryFilters);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [syncing, setSyncing] = useState(false);

  const headers = useMemo<string[]>(() => [...SUPPLY_DISPLAY_HEADERS], []);

  const query: SupplyQuery = useMemo(
    () => ({ filters: filterState, sort }),
    [filterState, sort],
  );

  const queryKey = useMemo(
    () => JSON.stringify({ filters: filterState, sort }),
    [filterState, sort],
  );

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        columnFilters: filterState.columnFilters,
        multiFilters: filterState.multiFilters,
        batchFilters: filterState.batchFilters,
        dateFrom: filterState.dateFrom,
        dateTo: filterState.dateTo,
        globalSearch: filterState.globalSearch,
      }),
    [filterState],
  );

  const {
    data,
    rows,
    ids,
    total,
    syncedAt,
    loading,
    refreshing,
    error,
    getFacetOptions,
    requestFacet,
    refresh,
    patchCell,
  } = useServerTable<SupplyPageResult>({
    queryKey,
    filterKey,
    fetchPage: () => fetchSupplyPage(query),
    fetchFacet: (header) => fetchSupplyFacet(query, header),
  });

  const bomIdOptionsById = useMemo(
    () => data?.bomIdOptions ?? {},
    [data],
  );
  const utilityOptions = useMemo(
    () => data?.utilityOptions ?? [],
    [data],
  );

  const changePage = useCallback(
    (page: number) => dispatch(setPage(page)),
    [dispatch],
  );
  const changePageSize = useCallback(
    (size: number) => {
      dispatch(setPageSize(size));
      dispatch(setPage(1));
    },
    [dispatch],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        dispatch(setColumnFilter({ header, value })),
      onMultiFilter: (header: string, values: string[]) =>
        dispatch(setMultiFilter({ header, values })),
      onBatchFilter: (key: string, value: boolean) =>
        dispatch(setBatchFilter({ key, value })),
      onDateFrom: (val: string) => dispatch(setDateFrom(val)),
      onDateTo: (val: string) => dispatch(setDateTo(val)),
      onGlobalSearch: (val: string) => dispatch(setGlobalSearch(val)),
      onResetFilters: () => {
        dispatch(resetFilters());
        setSort(null);
      },
      onPageChange: changePage,
      onPageSizeChange: changePageSize,
    }),
    [dispatch, changePage, changePageSize],
  );

  const categoryOptions = useMemo(
    () => ({
      State: [...INDIAN_STATES],
      UTILITY: [...utilityOptions],
    }),
    [utilityOptions],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;

      // BOM COST edits the selected BomItem's cost (shared with the BOM
      // dashboard), so it routes to a dedicated action.
      if (header === "BOM COST") {
        const toastId = toast.loading("Updating BOM COST...");
        try {
          const res = await updateSupplyHistoryBomCostAction(id, value || null);
          if (!res.success) {
            throw new Error(res.error || "Failed to update BOM COST");
          }
          toast.success("BOM COST updated", { id: toastId });
          void refresh();
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to update BOM COST",
            { id: toastId },
          );
        }
        return;
      }

      const field = SUPPLY_HEADER_TO_DB_FIELD[header];
      if (!field) return;

      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await updateSupplyHistoryFieldAction(id, field, value || null);
        patchCell(id, colIndex, value || null);
        toast.success(`${header} updated`, { id: toastId });
        void refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : `Failed to update ${header}`,
          { id: toastId },
        );
      }
    },
    [headers, patchCell, refresh],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      const toastId = toast.loading("Saving BOM...");
      try {
        const res = await updateSupplyHistorySelectedBomAction(id, bomId);
        if (!res.success) throw new Error(res.error || "Failed to save BOM");
        toast.success("BOM saved", { id: toastId });
        void refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save BOM",
          { id: toastId },
        );
      }
    },
    [refresh],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/supply-history/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await refresh();
      toast.success("Supply History synced");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const serverMode: ServerTableMode = useMemo(
    () => ({
      total,
      page: filterState.currentPage,
      pageSize: filterState.pageSize,
      loading,
      refreshing,
      sort: sort
        ? { column: headers.indexOf(sort.header), direction: sort.direction }
        : null,
      onSortChange: (next) => {
        if (!next) {
          setSort(null);
          return;
        }
        const header = headers[next.column];
        setSort(header ? { header, direction: next.direction } : null);
        dispatch(setPage(1));
      },
      onPageChange: changePage,
      onPageSizeChange: changePageSize,
      getFacetOptions,
      requestFacet,
      getAllRows: () => fetchAllSupplyRows(query),
    }),
    [
      total,
      filterState.currentPage,
      filterState.pageSize,
      loading,
      refreshing,
      sort,
      headers,
      dispatch,
      changePage,
      changePageSize,
      getFacetOptions,
      requestFacet,
      query,
    ],
  );

  if (loading && rows.length === 0) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
            <GMDUpdateSkeleton />
          </div>
        </div>
      </main>
    );
  }

  if (error && rows.length === 0) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
          <ErrorState message={error} onRetry={refresh} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          title="SUPPLY HISTORY"
          totalRows={total}
          syncedAt={syncedAt ?? undefined}
          onSync={handleSync}
          syncing={syncing}
        />
        {error && rows.length > 0 && (
          <div className="mt-2 text-sm text-red-600 dark:text-red-300 shrink-0">
            {error}
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
          <GMDUpdateTable
            headers={headers}
            rows={rows}
            ids={ids}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="Supply History"
            editable
            editableColumns={["Party Mail Address", "State", "UTILITY", "BOM COST"]}
            onCellUpdate={handleCellUpdate}
            categoryOptions={categoryOptions}
            uniqueKeyColumns={["INVOICE NO", "item name"]}
            hiddenColumns={[C_BATCH_HEADER]}
            cellBadges={cBatchBadges("ERP ITEM CODE")}
            batchFilterHeader="ERP ITEM CODE"
            batchPresenceFilters={SUPPLY_HISTORY_BATCH_FILTERS}
            bomIdOptionsById={bomIdOptionsById}
            onSelectBomId={handleSelectBomId}
            filterState={filterState}
            filterActions={filterActions}
            serverMode={serverMode}
            fullHeight
          />
        </div>
      </div>
    </main>
  );
}
