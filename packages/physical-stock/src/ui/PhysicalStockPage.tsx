"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { COLUMNS, FIELDS, NUMERIC_COLUMNS, rowToArray } from "../columns";
import type { PhysicalStockFlags, SidebarSection } from "../flags";
import type { PhysicalStockActions, PhysicalStockRow } from "../types";
import StockAnalyticsSidebar, { type MajorMinorKind, type StockCardKind } from "./StockAnalyticsSidebar";
import NewItemDialog from "./NewItemDialog";

const HEADERS = [...COLUMNS] as string[];
const AVAILABLE_IDX = COLUMNS.indexOf("AVAILABLE QTY.");
const RATE_IDX = COLUMNS.indexOf("rate/unit");
const MAJOR_IDX = COLUMNS.indexOf("MAJOR/MINOR MARKING");

function toNum(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const majorMinorKind = (value: unknown): MajorMinorKind =>
  value === true ? "yes" : value === false ? "no" : "blank";

export interface PhysicalStockPageProps {
  flags: PhysicalStockFlags;
  actions: PhysicalStockActions;
  /** Set false when the host app renders the header (and New button) elsewhere. */
  showHeader?: boolean;
}

export function PhysicalStockPage({ flags, actions, showHeader = true }: PhysicalStockPageProps) {
  const [items, setItems] = useState<PhysicalStockRow[]>([]);
  const [bomIdOptions, setBomIdOptions] = useState<Record<string, string[]>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [filteredRows, setFilteredRows] = useState<unknown[][]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cardFilter, setCardFilter] = useState<StockCardKind | null>(null);
  const [majorMinorFilter, setMajorMinorFilter] = useState<Set<MajorMinorKind>>(new Set());

  const { load, sync, updateField, create, updateBomId } = actions;

  const { editableColumns, blankOnlyColumns, showSection } = useMemo(() => {
    const hiddenSidebar = new Set<string>(flags.hiddenSidebar);
    return {
      // ERP CODE is only ever fillable while blank.
      editableColumns: flags.editableColumns.filter((h) => h !== "ERP CODE" && (h !== "BOM ID" || updateBomId)),
      blankOnlyColumns: flags.editableColumns.filter((h) => h === "ERP CODE"),
      showSection: (s: SidebarSection) => !hiddenSidebar.has(s),
    };
  }, [flags, updateBomId]);

  const loadData = useCallback(async () => {
    const res = await load();
    if (res.success) {
      setItems(res.data.items);
      setBomIdOptions(res.data.bomIdOptions ?? {});
    } else {
      toast.error(res.error || "Failed to load physical stock data.");
    }
    setLoading(false);
  }, [load]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // A "New" button rendered outside this component (e.g. the app navbar) asks
  // the table to reload through this event.
  useEffect(() => {
    const onCreated = () => loadData();
    window.addEventListener("physical-stock:created", onCreated);
    return () => window.removeEventListener("physical-stock:created", onCreated);
  }, [loadData]);

  const rows = useMemo(() => items.map(rowToArray), [items]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);

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
    for (const row of baseRows.rows) counts[majorMinorKind(row[MAJOR_IDX])]++;
    return counts;
  }, [baseRows]);

  // Major/Minor filter narrows the table without touching other filters.
  const { displayRows, displayIds } = useMemo(() => {
    if (majorMinorFilter.size === 0) return { displayRows: baseRows.rows, displayIds: baseRows.ids };
    const rowsOut: unknown[][] = [];
    const idsOut: string[] = [];
    for (let i = 0; i < baseRows.rows.length; i++) {
      if (!majorMinorFilter.has(majorMinorKind(baseRows.rows[i][MAJOR_IDX]))) continue;
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
      qty += available;
      value += toNum(row[RATE_IDX]) * available;
    }
    return { availableQty: qty, availableValue: value };
  }, [filteredRows]);

  const mergeRow = useCallback((id: string, changes: Partial<PhysicalStockRow>) => {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }, []);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = COLUMNS[colIndex];
      const toastId = toast.loading(`Updating ${header}...`);
      const res = await updateField(id, FIELDS[colIndex], value);
      if (res.success) {
        mergeRow(id, res.data);
        toast.success(`${header} updated`, { id: toastId });
      } else {
        toast.error(res.error || `Failed to update ${header}`, { id: toastId });
      }
    },
    [updateField, mergeRow],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      if (!updateBomId) return;
      const toastId = toast.loading("Saving BOM ID...");
      const res = await updateBomId(id, bomId);
      if (res.success) {
        mergeRow(id, res.data);
        toast.success("BOM ID saved", { id: toastId });
      } else {
        toast.error(res.error || "Failed to save BOM ID", { id: toastId });
      }
    },
    [updateBomId, mergeRow],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await sync();
      if (res.success) {
        const d = res.data;
        toast.success(`Synced ${d.totalRows} rows from the sheet (${d.created} new, ${d.skipped} unchanged).`);
        setSyncedAt(d.syncedAt);
        await loadData();
      } else {
        toast.error(res.error || "Sync failed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [sync, loadData]);

  const showNew = showHeader && flags.newItem && create;

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        {showHeader && (
          <GMDUpdateHeader
            totalRows={items.length}
            syncedAt={syncedAt}
            onSync={flags.sync ? handleSync : undefined}
            syncing={syncing}
            title="Physical Stock"
            actions={
              showNew && (
                <button
                  type="button"
                  onClick={() => setShowNewDialog(true)}
                  className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-400 dark:text-emerald-300 transition-all"
                >
                  <Plus size={12} />
                  New
                </button>
              )
            }
          />
        )}
        {showNew && (
          <NewItemDialog
            open={showNewDialog}
            onOpenChange={setShowNewDialog}
            rows={items}
            create={create}
            onCreated={loadData}
          />
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading physical stock...
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-4 mt-4">
            <StockAnalyticsSidebar
              show={showSection}
              availableQty={availableQty}
              availableValue={availableValue}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((c) => !c)}
              activeCard={cardFilter}
              onCardClick={(kind) => setCardFilter((prev) => (prev === kind ? null : kind))}
              majorMinorSelection={majorMinorFilter}
              majorMinorCounts={majorMinorCounts}
              onToggleMajorMinor={toggleMajorMinor}
            />
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              <GMDUpdateTable
                headers={HEADERS}
                rows={displayRows}
                ids={displayIds}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                title="Physical Stock"
                editable
                editableColumns={editableColumns}
                blankOnlyEditableColumns={blankOnlyColumns}
                hiddenColumns={flags.hiddenColumns}
                numericColumns={NUMERIC_COLUMNS}
                bomIdOptionsById={updateBomId ? bomIdOptions : undefined}
                onSelectBomId={updateBomId ? handleSelectBomId : undefined}
                onCellUpdate={handleCellUpdate}
                onFilteredRowsChange={setFilteredRows}
                duplicateErpHighlight={flags.duplicateErpHighlight}
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
