"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import StockAnalyticsSidebar, {
  type StockCardKind,
  type MajorMinorKind,
} from "@/components/gmd_dashboard/StockAnalyticsSidebar";
import {
  PHYSICAL_COLUMNS,
  PHYSICAL_COL_INDEX_TO_DB_FIELD,
  PHYSICAL_EDITABLE_COLUMNS,
  PHYSICAL_NUMERIC_COLUMNS,
} from "@/lib/gmd_lib/physical-stock-columns";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  hydratePhysicalStock,
  updatePhysicalStockField,
  updatePhysicalStockBomId,
  setPhysicalStockBomIdOptions,
  selectPhysicalStockRowsArray,
  selectPhysicalStockIds,
  selectPhysicalStockBomIdOptions,
} from "@/lib/physicalStockSlice";
import type { PhysicalStockRow } from "@/lib/physicalStockSlice";

interface PhysicalStockApiResponse {
  headers: string[];
  items: PhysicalStockRow[];
  bomIdOptions?: Record<string, string[]>;
  totalRows: number;
}

const AVAILABLE_IDX = PHYSICAL_COLUMNS.indexOf("AVAILABLE QTY.");
const RATE_IDX = PHYSICAL_COLUMNS.indexOf("rate/unit");
const MAJOR_IDX = PHYSICAL_COLUMNS.indexOf("MAJOR/MINOR MARKING");

function toNum(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function Home() {
  const dispatch = useAppDispatch();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [filteredRows, setFilteredRows] = useState<unknown[][]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cardFilter, setCardFilter] = useState<StockCardKind | null>(null);
  const [majorMinorFilter, setMajorMinorFilter] = useState<Set<MajorMinorKind>>(
    new Set(),
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/physical_stock/api/physical-stock", {
        cache: "no-store",
      });
      const data: PhysicalStockApiResponse = await res.json();
      dispatch(hydratePhysicalStock(data.items));
      dispatch(setPhysicalStockBomIdOptions(data.bomIdOptions ?? {}));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to load physical stock data.",
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rows = useAppSelector(selectPhysicalStockRowsArray);
  const ids = useAppSelector(selectPhysicalStockIds);
  const totalRows = useMemo(() => rows.length, [rows]);
  const bomIdOptionsById = useAppSelector(selectPhysicalStockBomIdOptions);

  // Stat-card filter: keep rows with a positive available qty / value.
  const baseRows = useMemo(() => {
    if (!cardFilter) return { rows, ids };
    const rowsOut: unknown[][] = [];
    const idsOut: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const qty = toNum(rows[i][AVAILABLE_IDX]);
      const rate = toNum(rows[i][RATE_IDX]);
      if (cardFilter === "qty" && qty <= 0) continue;
      if (cardFilter === "value" && rate * qty <= 0) continue;
      rowsOut.push(rows[i]);
      idsOut.push(ids[i]);
    }
    return { rows: rowsOut, ids: idsOut };
  }, [rows, ids, cardFilter]);

  const majorMinorCounts = useMemo(() => {
    const counts: Record<MajorMinorKind, number> = { yes: 0, no: 0, blank: 0 };
    for (const row of baseRows.rows) {
      const value = row[MAJOR_IDX];
      if (value === true) counts.yes++;
      else if (value === false) counts.no++;
      else counts.blank++;
    }
    return counts;
  }, [baseRows]);

  // Major/Minor card filter narrows the table without touching other filters.
  const { displayRows, displayIds } = useMemo(() => {
    if (majorMinorFilter.size === 0) {
      return { displayRows: baseRows.rows, displayIds: baseRows.ids };
    }
    const rowsOut: unknown[][] = [];
    const idsOut: string[] = [];
    for (let i = 0; i < baseRows.rows.length; i++) {
      const value = baseRows.rows[i][MAJOR_IDX];
      const kind: MajorMinorKind =
        value === true ? "yes" : value === false ? "no" : "blank";
      if (!majorMinorFilter.has(kind)) continue;
      rowsOut.push(baseRows.rows[i]);
      idsOut.push(baseRows.ids[i]);
    }
    return { displayRows: rowsOut, displayIds: idsOut };
  }, [baseRows, majorMinorFilter]);

  const toggleMajorMinor = useCallback((kind: MajorMinorKind) => {
    setMajorMinorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  // Sums follow the table's own column/global filters (onFilteredRowsChange).
  const { availableQty, availableValue } = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const row of filteredRows) {
      const available = toNum(row[AVAILABLE_IDX]);
      const rate = toNum(row[RATE_IDX]);
      qty += available;
      value += rate * available;
    }
    return { availableQty: qty, availableValue: value };
  }, [filteredRows]);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const field = PHYSICAL_COL_INDEX_TO_DB_FIELD[colIndex];
      if (!field) return;
      const header = PHYSICAL_COLUMNS[colIndex];
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await dispatch(updatePhysicalStockField({ id, field, value })).unwrap();
        toast.success(`${header} updated`, { id: toastId });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : `Failed to update ${header}`,
          { id: toastId },
        );
      }
    },
    [dispatch],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      const toastId = toast.loading("Saving BOM ID...");
      try {
        await dispatch(updatePhysicalStockBomId({ id, bomId })).unwrap();
        toast.success("BOM ID saved", { id: toastId });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save BOM ID",
          { id: toastId },
        );
      }
    },
    [dispatch],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/physical_stock/api/physical-stock/sync", {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Sync failed.");
      } else {
        toast.success(
          `Synced ${data.totalRows} rows from the sheet (${data.created} new, ${data.skipped} unchanged).`,
        );
        setSyncedAt(data.syncedAt ?? null);
        await loadData();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          totalRows={totalRows}
          syncedAt={syncedAt}
          onSync={handleSync}
          syncing={syncing}
          title="Physical Stock"
        />
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading physical stock...
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-4 mt-4">
            <StockAnalyticsSidebar
              availableQty={availableQty}
              availableValue={availableValue}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((c) => !c)}
              activeCard={cardFilter}
              onCardClick={(kind) =>
                setCardFilter((prev) => (prev === kind ? null : kind))
              }
              majorMinorSelection={majorMinorFilter}
              majorMinorCounts={majorMinorCounts}
              onToggleMajorMinor={toggleMajorMinor}
            />
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              <GMDUpdateTable
                headers={PHYSICAL_COLUMNS}
                rows={displayRows}
                ids={displayIds}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                title="Physical Stock"
                editable
                editableColumns={PHYSICAL_EDITABLE_COLUMNS}
                numericColumns={PHYSICAL_NUMERIC_COLUMNS}
                bomIdOptionsById={bomIdOptionsById}
                onSelectBomId={handleSelectBomId}
                onCellUpdate={handleCellUpdate}
                onFilteredRowsChange={setFilteredRows}
                duplicateErpHighlight
                fullHeight
              />
            </div>
          </div>
        )}
        {syncing && (
          <div className="fixed bottom-4 right-4 flex items-center gap-1.5 rounded-lg bg-[#0a2540] text-white px-3 py-2 text-xs font-semibold shadow-lg">
            <RefreshCw size={12} className="animate-spin" />
            Syncing sheet...
          </div>
        )}
      </div>
    </main>
  );
}
