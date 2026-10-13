"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import GMDUpdateTable from "@/components/gmd_dashboard/GMDUpdateTable";
import GMDUpdateHeader from "@/components/gmd_dashboard/GMDUpdateHeader";
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

export default function Home() {
  const dispatch = useAppDispatch();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

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
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
            <GMDUpdateTable
              headers={PHYSICAL_COLUMNS}
              rows={rows}
              ids={ids}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title="Physical Stock"
              editable
              editableColumns={PHYSICAL_EDITABLE_COLUMNS}
              numericColumns={PHYSICAL_NUMERIC_COLUMNS}
              bomIdOptionsById={bomIdOptionsById}
              onSelectBomId={handleSelectBomId}
              onCellUpdate={handleCellUpdate}
              fullHeight
            />
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
