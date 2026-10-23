"use client";

import { useCallback, useMemo, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable, {
  type ServerTableMode,
} from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import { updateBisStatusFieldAction } from "@/app/actions";
import {
  fetchAllBisRows,
  fetchBisFacet,
  fetchBisPage,
} from "@/app/actions/bisQuery";
import { BIS_HEADER_TO_DB_FIELD, BIS_STATUS_HEADERS } from "@/lib/gmd_lib/bis-status-columns";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  setColumnFilter,
  setMultiFilter,
  setDateFrom,
  setDateTo,
  setGlobalSearch,
  setPage,
  setPageSize,
  resetFilters,
} from "@/lib/bisStatusFiltersSlice";
import { useServerTable } from "@/lib/useServerTable";
import type { BisQuery } from "@/lib/bisQuery";
import type { TableSort } from "@/lib/tableQuery";

const EDITABLE_FIELDS = new Set(["remark", "licenseNo"]);

export default function BisStatusPage() {
  const dispatch = useAppDispatch();
  const filterState = useAppSelector((s) => s.bisStatusFilters);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<TableSort | null>(null);

  const headers = useMemo<string[]>(() => [...BIS_STATUS_HEADERS], []);

  const query: BisQuery = useMemo(
    () => ({ filters: filterState, sort }),
    [filterState, sort],
  );

  const queryKey = useMemo(
    () => JSON.stringify({ filters: filterState, sort }),
    [filterState, sort],
  );

  // Paging/sorting must not invalidate the dropdown options.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        columnFilters: filterState.columnFilters,
        multiFilters: filterState.multiFilters,
        dateFrom: filterState.dateFrom,
        dateTo: filterState.dateTo,
        globalSearch: filterState.globalSearch,
      }),
    [filterState],
  );

  const {
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
  } = useServerTable({
    queryKey,
    filterKey,
    fetchPage: () => fetchBisPage(query),
    fetchFacet: (header) => fetchBisFacet(query, header),
  });

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

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = BIS_HEADER_TO_DB_FIELD[header];
      if (!field) return;
      if (!EDITABLE_FIELDS.has(field)) {
        toast.error(`Field ${header} is not editable`);
        return;
      }
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        const res = await updateBisStatusFieldAction(id, field, value || null);
        if (res?.success === false) {
          toast.error(res.error || `Failed to update ${header}`, { id: toastId });
          return;
        }
        patchCell(id, colIndex, value || null);
        toast.success(`${header} updated`, { id: toastId });
        // Filters, sort position and the header count may all have changed.
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

  const serverSort = useMemo(
    () =>
      sort
        ? { column: headers.indexOf(sort.header), direction: sort.direction }
        : null,
    [sort, headers],
  );

  const serverMode: ServerTableMode = useMemo(
    () => ({
      total,
      page: filterState.currentPage,
      pageSize: filterState.pageSize,
      loading,
      refreshing,
      sort: serverSort,
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
      getAllRows: () => fetchAllBisRows(query),
    }),
    [
      total,
      filterState.currentPage,
      filterState.pageSize,
      loading,
      refreshing,
      serverSort,
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
          <GMDUpdateHeader title="BIS STATUS" totalRows={0} />
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
          <GMDUpdateHeader title="BIS STATUS" totalRows={0} />
          <ErrorState message={error} onRetry={refresh} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          title="BIS STATUS"
          totalRows={total}
          syncedAt={syncedAt ?? undefined}
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
            title="BIS Status"
            editable
            editableColumns={["remark", "licenseNo"]}
            onCellUpdate={handleCellUpdate}
            uniqueKeyColumns={["bisNo"]}
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
