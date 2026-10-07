"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import { updateBisStatusFieldAction } from "@/app/actions";
import { BIS_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/bis-status-columns";
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

interface BisStatusData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

export default function BisStatusPage() {
  const [data, setData] = useState<BisStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const dispatch = useAppDispatch();
  const filterState = useAppSelector((s) => s.bisStatusFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bis-status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = data?.headers[colIndex];
      if (!header) return;
      const field = BIS_HEADER_TO_DB_FIELD[header];
      if (!field) return;
      const editableFields = new Set(["remark", "licenseNo"]);
      if (!editableFields.has(field)) {
        toast.error(`Field ${header} is not editable`);
        return;
      }
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        const res: any = await updateBisStatusFieldAction(id, field, value || null);
        if (res?.success === false) {
          toast.error(res.error || `Failed to update ${header}`, { id: toastId });
          return;
        }
        setData((prev) => {
          if (!prev) return prev;
          const colIdx = prev.headers.indexOf(header);
          if (colIdx === -1) return prev;
          const rowPos = prev.ids.indexOf(id);
          if (rowPos === -1) return prev;
          const nextRows = prev.rows.map((r, i) => (i === rowPos ? r.map((c, j) => (j === colIdx ? (value || null) : c)) : r));
          return { ...prev, rows: nextRows };
        });
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || `Failed to update ${header}`, { id: toastId });
      }
    },
    [data?.headers, data?.ids],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.ids ?? [];

  const categoryOptions = useMemo(() => {
    if (!data) return {};
    const opts: Record<string, string[]> = {};
    const dropdownCols = ["applicationStatus", "reachedLab", "licenseNo"];
    for (const col of dropdownCols) {
      const idx = headers.indexOf(col);
      if (idx === -1) continue;
      const vals = [...new Set(data.rows.map((r) => String(r[idx] ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      if (vals.length > 0) opts[col] = vals;
    }
    return opts;
  }, [data, headers]);

  const filterActions = useMemo(() => ({
    onColumnFilter: (header: string, value: string) => dispatch(setColumnFilter({ header, value })),
    onMultiFilter: (header: string, values: string[]) => dispatch(setMultiFilter({ header, values })),
    onDateFrom: (val: string) => dispatch(setDateFrom(val)),
    onDateTo: (val: string) => dispatch(setDateTo(val)),
    onGlobalSearch: (val: string) => dispatch(setGlobalSearch(val)),
    onResetFilters: () => dispatch(resetFilters()),
    onPageChange: (page: number) => dispatch(setPage(page)),
    onPageSizeChange: (size: number) => dispatch(setPageSize(size)),
  }), [dispatch]);

  if (loading) {
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

  if (error && !data) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="BIS STATUS" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          title="BIS STATUS"
          totalRows={data?.totalRows ?? 0}
          syncedAt={data?.syncedAt ?? undefined}
        />
        {error && (
          <div className="mt-2 text-sm text-red-600 dark:text-red-300 shrink-0">{error}</div>
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
          <GMDUpdateTable
            headers={headers}
            rows={data?.rows ?? []}
            ids={ids}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title={`BIS Status`}
            editable
            editableColumns={["remark", "licenseNo"]}
            onCellUpdate={handleCellUpdate}
            categoryOptions={categoryOptions}
            uniqueKeyColumns={["bisNo"]}
            filterState={filterState}
            filterActions={filterActions}
            fullHeight
          />
        </div>
      </div>
    </main>
  );
}
