"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  updateSupplyHistoryFieldAction,
  updateSupplyHistorySelectedBomAction,
  updateSupplyHistoryBomCostAction,
} from "@/app/actions";
import { SUPPLY_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/supply-history-columns";
import { C_BATCH_HEADER, cBatchBadges, cBatchFilter } from "@/lib/gmd_lib/verify-bom-columns";
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

interface SupplyHistoryData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
  utilityOptions?: string[];
  bomIdOptions?: Record<string, string[]>;
}

// Stable descriptor list so GMDUpdateTable's row predicate keeps a stable dep.
const SUPPLY_HISTORY_BATCH_FILTERS = [cBatchFilter()];

export default function SupplyHistoryPage() {
  const [data, setData] = useState<SupplyHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const dispatch = useAppDispatch();
  const filterState = useAppSelector((s) => s.supplyHistoryFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/supply-history");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setBomIdOptionsById(json.bomIdOptions ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/supply-history/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = data?.headers[colIndex];
      if (!header) return;

      // BOM COST edits the selected BomItem's cost (shared with the BOM
      // dashboard), so it routes to a dedicated action rather than the generic
      // Supply History field writer.
      if (header === "BOM COST") {
        const toastId = toast.loading("Updating BOM COST...");
        try {
          const res = await updateSupplyHistoryBomCostAction(id, value || null);
          if (!res.success) throw new Error(res.error || "Failed to update BOM COST");
          await fetchData();
          toast.success("BOM COST updated", { id: toastId });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Failed to update BOM COST";
          toast.error(message, { id: toastId });
        }
        return;
      }

      const field = SUPPLY_HEADER_TO_DB_FIELD[header];
      if (!field) return;

      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await updateSupplyHistoryFieldAction(id, field, value || null);
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || `Failed to update ${header}`, { id: toastId });
      }
    },
    [data?.headers, fetchData],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      const toastId = toast.loading("Saving BOM...");
      try {
        const res = await updateSupplyHistorySelectedBomAction(id, bomId);
        if (!res.success) throw new Error(res.error || "Failed to save BOM");
        await fetchData();
        toast.success("BOM saved", { id: toastId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to save BOM";
        toast.error(message, { id: toastId });
      }
    },
    [fetchData],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.ids ?? [];

  const categoryOptions = useMemo(() => {
    if (!data) return {};
    const opts: Record<string, string[]> = {};
    const dropdownCols = [
      "INVOICE NO", "item name", "party name",
      "Item Type", "MOC", "Size", "State",
      "FINANCIAL YEAR", "CLASS OF VALVE", "Warranty valid/Not",
      "BG NO", "PBG VALID TILL", "BOM ID",
    ];
    for (const col of dropdownCols) {
      const idx = headers.indexOf(col);
      if (idx === -1) continue;
      const vals = [...new Set(data.rows.map((r) => String(r[idx] ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      if (vals.length > 0) opts[col] = vals;
    }
    // Override State to show full India list for manual dropdown (blanks need all options)
    opts["State"] = [...INDIAN_STATES];
    // UTILITY dropdown now comes from LookupOption (type=UTILITY, isActive=true) via /api/supply-history
    opts["UTILITY"] = data.utilityOptions ? [...data.utilityOptions] : [];
    return opts;
  }, [data, headers]);

  const filterActions = useMemo(() => ({
    onColumnFilter: (header: string, value: string) => dispatch(setColumnFilter({ header, value })),
    onMultiFilter: (header: string, values: string[]) => dispatch(setMultiFilter({ header, values })),
    onBatchFilter: (key: string, value: boolean) => dispatch(setBatchFilter({ key, value })),
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
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
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
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          title="SUPPLY HISTORY"
          totalRows={data?.totalRows ?? 0}
          syncedAt={data?.syncedAt ?? undefined}
          onSync={handleSync}
          syncing={syncing}
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
            title={`Supply History`}
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
            fullHeight
          />
        </div>
      </div>
    </main>
  );
}
