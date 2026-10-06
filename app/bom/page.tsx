"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Database, Loader2, Tags } from "lucide-react";
import { RefreshCw } from "lucide-react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  updateVerifyBomFieldBatchAction,
  syncNullVerifyBomStockAction,
  syncBomMastItemNamesAction,
  checkBomMastSyncAction,
  deriveVerifyBomItemNameBatchAction,
  recomputeVerifyBomBomQtyCostBatchAction,
} from "@/app/actions";
import { VERIFY_BOM_HEADER_TO_DB_FIELD, cBatchBadges } from "@/lib/gmd_lib/verify-bom-columns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ItemNamePlan = {
  phase1: {
    tabTitle: string;
    sheetRows: number;
    skippedNoKey: number;
    withToDate: number;
    withoutToDate: number;
    willMark: number;
    willAddBatch: number;
    alreadyCorrect: number;
    willCreate: number;
    staleNoUse: number;
    untouchedBlank: number;
    use: number;
    samples: {
      willAddBatch: string[];
      willCreate: string[];
      staleNoUse: string[];
      staleBatch: string[];
    };
  };
  phase2: {
    tabTitle: string;
    sheetCodes: number;
    duplicateCodes: number;
    scanned: number;
    itemNameChanged: number;
    rmItemNameChanged: number;
    unchanged: number;
    unmatched: number;
    samples: string[];
  };
};

const ITEM_CODE_BADGES = cBatchBadges("ITEM CODE");

const TABLE2_EDITABLE_COLUMNS = [
  "BOM ID TYPE",
  "BOM ITEM QTY",
  "ITEM SCHEDULE NAME",
  "ITEM TYPE",
  "MOC",
  "OPERATION",
  "SIZE",
  "NO",
  "PN-GMD",
  "CURRENT REQT",
  "NEW ITEM NAME",
  "DUPLICATE MERGER COUNT",
  "BOM NATURE",
  "CONSUMPTION-1",
  "CONSUMPTION 2",
  "CONSUMPTION 3",
];

// Grouped view column order: parent (once per ITEM CODE), then BOM (once per
// BOM ID), then RM detail (one line per row). GMDUpdateTable collapses a column
// by rowSpan when consecutive rows share the group key and the cell value, so
// listing all parent + BOM headers in mergeColumns renders them once and the
// RM headers below them once per row.
const GROUPED_PARENT_HEADERS = [
  "ITEM CODE",
  "ITEM NAME",
  "ITEM SCHEDULE NAME",
  "ITEM TYPE",
  "MOC",
  "OPERATION",
  "SIZE",
  "NO",
  "PN-GMD",
  "CURRENT REQT",
  "NEW ITEM NAME",
  "DUPLICATE MERGER COUNT",
  "BOM NATURE",
  "CONSUMPTION-1",
  "CONSUMPTION 2",
  "CONSUMPTION 3",
];

const GROUPED_BOM_HEADERS = ["BOM ID", "BOM COST", "BOM ID TYPE", "BOM ITEM QTY"];

const GROUPED_DETAIL_HEADERS = [
  "RM ITEM CODE",
  "RM ITEM NAME",
  "USE/NO USE",
  "AVAILABLE STOCK",
  "COST",
  "BOM ITEM QTY * COST",
];

const GROUPED_MERGE_COLUMNS = [
  ...GROUPED_PARENT_HEADERS,
  ...GROUPED_BOM_HEADERS,
];

const GROUPED_HEADER_ORDER = [
  ...GROUPED_PARENT_HEADERS,
  ...GROUPED_BOM_HEADERS,
  ...GROUPED_DETAIL_HEADERS,
];

interface BomData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

export default function BomPage() {
  const [data, setData] = useState<BomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [syncingStock, setSyncingStock] = useState(false);
  const [syncingItemName, setSyncingItemName] = useState(false);
  const [confirmItemName, setConfirmItemName] = useState(false);
  const [itemNamePlan, setItemNamePlan] = useState<ItemNamePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedNoIndex, setSelectedNoIndex] = useState<number | null>(null);
  const [selectedGroupedIndex, setSelectedGroupedIndex] = useState<
    number | null
  >(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bom");
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

  const handleSyncMissingStock = useCallback(async () => {
    setSyncingStock(true);
    const toastId = toast.loading("Checking Google Sheets for missing available stock...");
    try {
      const res = await syncNullVerifyBomStockAction();
      if (!res?.success) {
        toast.error(res?.error || "Failed to sync available stock", { id: toastId });
        return;
      }
      const {
        updatedCount = 0,
        totalNullCount = 0,
        matchedByRmCode = 0,
        matchedByItemCode = 0,
        unmatched = 0,
        unmatchedSamples = [] as string[],
      } = res;

      if (unmatchedSamples.length > 0) {
        console.warn(
          `[Sync Missing Stock] ${unmatched} row(s) had no SUM OF PHYSICAL STOCK entry (first ${unmatchedSamples.length}):\n` +
            unmatchedSamples.map((s) => `  ${s}`).join("\n"),
        );
      }

      if (updatedCount === 0) {
        toast.info(
          `Checked ${totalNullCount} null items: no matching stock found in stock-phys.`,
          { id: toastId },
        );
      } else {
        toast.success(
          `Populated ${updatedCount} item(s) — rmItemCode: ${matchedByRmCode}, itemCode: ${matchedByItemCode}, still unmatched: ${unmatched}`,
          { id: toastId },
        );
      }
      await fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync available stock", { id: toastId });
    } finally {
      setSyncingStock(false);
    }
  }, [fetchData]);

  const handleCheckItemNames = useCallback(async () => {
    setSyncingItemName(true);
    const toastId = toast.loading("Checking BOM MAST ERP + ITEM MASTER ERP...");
    try {
      const res = await checkBomMastSyncAction();
      if (!res || !res.success || !res.plan) {
        toast.error(res?.error || "Failed to check sheets", { id: toastId });
        return;
      }
      setItemNamePlan(res.plan);
      setConfirmItemName(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to check sheets", { id: toastId });
    } finally {
      setSyncingItemName(false);
      toast.dismiss(toastId);
    }
  }, []);

  const handleSyncItemNames = useCallback(async () => {
    setConfirmItemName(false);
    setSyncingItemName(true);
    const toastId = toast.loading(
      "Marking TO_DATE rows NO USE + C, then applying ITEM MASTER ERP names...",
    );
    try {
      const res = await syncBomMastItemNamesAction();
      if (!res || !res.success || !res.applied) {
        toast.error(res?.error || "Failed to sync item names", { id: toastId });
        return;
      }
      const a = res.applied;
      if (a.unmatchedSamples.length) {
        console.warn(
          `[ItemName (C)] ${a.unmatchedSamples.length} code(s) not found in ITEM MASTER ERP:\n` +
            a.unmatchedSamples.map((c) => `  ${c}`).join("\n"),
        );
      }
      toast.success(
        `BOM MAST: ${a.marked} row(s) set NO USE + C, ${a.created} created. ` +
          `ITEM MASTER: ${a.itemNameChanged} item name(s) + ${a.rmItemNameChanged} RM item name(s) updated.`,
        { id: toastId },
      );
      setItemNamePlan(null);
      await fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync item names", { id: toastId });
    } finally {
      setSyncingItemName(false);
    }
  }, [fetchData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/sync", { method: "POST" });
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

  const handleMetaSync = useCallback(async () => {
    setSyncingMeta(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/sync-meta", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync Item Meta failed (${res.status})`);
      }
      const json = await res.json();
      toast.success(`Item meta synced: ${json.count ?? 0} row(s) updated`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync Item Meta failed");
    } finally {
      setSyncingMeta(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.ids ?? [];

  const autoItemNameRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const itemTypeIdx = headers.indexOf("ITEM TYPE");
    const mocIdx = headers.indexOf("MOC");
    const operationIdx = headers.indexOf("OPERATION");
    const sizeIdx = headers.indexOf("SIZE");
    const pnGmdIdx = headers.indexOf("PN-GMD");
    const newItemNameIdx = headers.indexOf("NEW ITEM NAME");
    if (
      [itemTypeIdx, mocIdx, operationIdx, sizeIdx, pnGmdIdx, newItemNameIdx].some(
        (i) => i < 0,
      )
    ) {
      return;
    }
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoItemNameRef.current.has(id)) return;
      const parts = [row[itemTypeIdx], row[mocIdx], row[operationIdx], row[sizeIdx], row[pnGmdIdx]].map(
        (v) => String(v ?? "").trim(),
      );
      const derived = parts.some((p) => p === "") ? "" : parts.join("_");
      const current = String(row[newItemNameIdx] ?? "").trim();
      if (current === derived) return;
      autoItemNameRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    deriveVerifyBomItemNameBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map((res.data ?? []).map((d) => [d.id, d.merged ?? ""]));
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined) return row;
            const next = [...row];
            next[newItemNameIdx] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const autoBomQtyCostRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const bomItemQtyIdx = headers.indexOf("BOM ITEM QTY");
    const costIdx = headers.indexOf("COST");
    const bomItemQtyCostIdx = headers.indexOf("BOM ITEM QTY * COST");
    if ([bomItemQtyIdx, costIdx, bomItemQtyCostIdx].some((i) => i < 0)) {
      return;
    }
    const parseNum = (v: unknown): number | null => {
      const s = String(v ?? "").replace(/,/g, "").trim();
      if (!s || s === "-") return null;
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };
    const compute = (row: unknown[]): string => {
      const qty = parseNum(row[bomItemQtyIdx]);
      const cost = parseNum(row[costIdx]);
      if (qty === null) return "";
      if (cost === null) return "RM COST NOT AVAILABLE";
      return (Math.round(qty * cost * 100) / 100).toString();
    };
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoBomQtyCostRef.current.has(id)) return;
      const current = String(row[bomItemQtyCostIdx] ?? "").trim();
      if (current === compute(row)) return;
      autoBomQtyCostRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    recomputeVerifyBomBomQtyCostBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map(
          (res.data ?? []).map((d) => [d.id, d.bomItemQtyCost ?? ""]),
        );
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined) return row;
            const next = [...row];
            next[bomItemQtyCostIdx] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const { yesRows, yesIds, noRows, noIds } = useMemo(() => {
    const yesRows: unknown[][] = [];
    const yesIds: string[] = [];
    const noRows: unknown[][] = [];
    const noIds: string[] = [];
    const rows = data?.rows ?? [];
    const currentReqtIdx = headers.indexOf("CURRENT REQT");
    rows.forEach((row, i) => {
      const v =
        currentReqtIdx >= 0
          ? String(row[currentReqtIdx] ?? "").trim().toLowerCase()
          : "";
      if (v === "yes") {
        yesRows.push(row);
        yesIds.push(ids[i]);
      } else {
        noRows.push(row);
        noIds.push(ids[i]);
      }
    });
    return { yesRows, yesIds, noRows, noIds };
  }, [data, headers, ids]);

  // Reorder every row into GROUPED_HEADER_ORDER and sort by ITEM CODE then
  // BOM ID so equal BOM IDs sit on consecutive rows. GMDUpdateTable only merges
  // consecutive rows, so this ordering is what makes the BOM cells collapse.
  const groupedData = useMemo(() => {
    const srcRows = data?.rows ?? [];
    const srcIds = data?.ids ?? [];
    const srcHeaders = data?.headers ?? [];
    const itemCodeIdx = srcHeaders.indexOf("ITEM CODE");
    const bomIdIdx = srcHeaders.indexOf("BOM ID");
    const colMap = GROUPED_HEADER_ORDER.map((h) => srcHeaders.indexOf(h));
    const decorated = srcRows
      .map((row, i) => ({
        id: srcIds[i],
        row: colMap.map((j) => (j >= 0 ? row[j] : "")),
        itemCode: String(row[itemCodeIdx] ?? "").trim(),
        bomId: String(row[bomIdIdx] ?? "").trim(),
      }))
      .filter((d) => d.id !== undefined);
    decorated.sort(
      (a, b) =>
        a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true }) ||
        a.bomId.localeCompare(b.bomId, undefined, { numeric: true }),
    );

    // One ITEM CODE spans many rows and a parent cell may be filled on only some
    // of them. Copy the first non-empty value across every row of the group so
    // GMDUpdateTable can collapse the whole group into a single spanned cell
    // (its merge only fires on equal consecutive values) and the cell shows the
    // non-null value instead of blank.
    const parentCount = GROUPED_PARENT_HEADERS.length;
    for (let i = 0; i < decorated.length; ) {
      let j = i;
      while (
        j + 1 < decorated.length &&
        decorated[j + 1].itemCode === decorated[i].itemCode
      ) {
        j++;
      }
      for (let c = 0; c < parentCount; c++) {
        let value: unknown = "";
        for (let k = i; k <= j; k++) {
          if (String(decorated[k].row[c] ?? "").trim() !== "") {
            value = decorated[k].row[c];
            break;
          }
        }
        if (value !== "") {
          for (let k = i; k <= j; k++) decorated[k].row[c] = value;
        }
      }
      i = j + 1;
    }

    return {
      headers: GROUPED_HEADER_ORDER,
      rows: decorated.map((d) => d.row) as unknown[][],
      ids: decorated.map((d) => d.id),
    };
  }, [data]);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      if (!data) return;
      const header = headers[colIndex];
      if (!header) return;
      const field = VERIFY_BOM_HEADER_TO_DB_FIELD[header];
      if (!field) return;

      const bomIdIdx = headers.indexOf("BOM ID");
      const rowIdx = data.ids.indexOf(id);
      const bomId =
        rowIdx !== -1 ? String(data.rows[rowIdx][bomIdIdx] ?? "").trim() : "";

      let groupIds = [id];
      if (field === "bomIdType" && bomId) {
        groupIds = data.rows
          .map((r, i) => ({
            id: data.ids[i],
            bom: String(r[bomIdIdx] ?? "").trim(),
          }))
          .filter((x) => x.bom === bomId)
          .map((x) => x.id);
      }

      const toastId = toast.loading("Updating...");
      try {
        const res = await updateVerifyBomFieldBatchAction(
          groupIds,
          field,
          value || null,
        );
        if (res?.success) {
          const idSet = new Set(groupIds);
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              rows: prev.rows.map((row, i) =>
                idSet.has(prev.ids[i])
                  ? (() => {
                      const next = [...row];
                      next[colIndex] = value;
                      return next;
                    })()
                  : row,
              ),
            };
          });
          toast.success(`Updated ${groupIds.length} row(s)`, { id: toastId });
        } else {
          toast.error(res?.error || "Failed to update", { id: toastId });
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to update", { id: toastId });
      }
    },
    [data, headers],
  );

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="VERIFY BOM" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="VERIFY BOM" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex flex-col p-6 min-h-0">
        <GMDUpdateHeader
          title="VERIFY BOM"
          totalRows={data?.totalRows ?? 0}
          syncedAt={data?.syncedAt ?? undefined}
          onSync={handleSync}
          syncing={syncing}
          actions={
            <>
            <button
              onClick={handleMetaSync}
              disabled={syncingMeta}
              className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncingMeta ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Database size={12} />
              )}
              {syncingMeta ? "Syncing..." : "Sync Item Meta"}
            </button>
          
            <button
              type="button"
              onClick={handleSyncMissingStock}
              disabled={syncingStock || loading}
              className="flex items-center gap-1.5 bg-[#38ef7d]/10 hover:bg-[#38ef7d]/20 border border-[#38ef7d]/40 rounded px-3 py-1.5 text-[11px] font-semibold text-[#38ef7d] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="Find null available stock in VerifyBom, match with Google Sheet, and backfill available stock"
            >
              {syncingStock ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {syncingStock ? "Syncing Stock..." : "Sync Missing Stock"}
            </button>

            <button
              type="button"
              onClick={handleCheckItemNames}
              disabled={syncingItemName || loading}
              className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-amber-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="Mark TO_DATE rows from BOM MAST ERP as NO USE + batch C, then fill item names from ITEM MASTER ERP"
            >
              {syncingItemName ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Tags size={12} />
              )}
              {syncingItemName ? "Syncing..." : "ItemName (C)"}
            </button>
            </>
          }
        />
        {error && (
          <div className="mt-2 text-sm text-red-600">{error}</div>
        )}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1 mt-4">
          {/*
          <GMDUpdateTable
            headers={headers}
            rows={yesRows}
            ids={yesIds}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="Verify BOM — YES"
            groupByColumn="BOM ID"
            mergeColumns={["BOM ID", "ITEM CODE", "BOM ID TYPE", "USE/NO USE", "AVAILABLE STOCK"]}
            mergeTypeColumn="BOM ID TYPE"
            mergeOnlyTypes={["2:1", "3:1"]}
            editable
            editableColumns={["BOM ID TYPE"]}
            fixedDropdownOptions={{ "BOM ID TYPE": ["2:1", "3:1", "DIRECT M2M", "CREATE BOM"] }}
            onCellUpdate={handleCellUpdate}
            hiddenColumns={["ITEM SCHEDULE NAME", "C BATCH"]}
            cellBadges={ITEM_CODE_BADGES}
          />
          <GMDUpdateTable
            headers={headers}
            rows={noRows}
            ids={noIds}
            selectedIndex={selectedNoIndex}
            onSelect={setSelectedNoIndex}
            title="Verify BOM — NO/Blank"
            groupByColumn="BOM ID"
            mergeColumns={["BOM ID", "ITEM CODE", "BOM ID TYPE", "USE/NO USE", "AVAILABLE STOCK"]}
            mergeTypeColumn="BOM ID TYPE"
            mergeOnlyTypes={["2:1", "3:1"]}
            editable
            editableColumns={TABLE2_EDITABLE_COLUMNS}
            fixedDropdownOptions={{ "BOM ID TYPE": ["2:1", "3:1", "DIRECT M2M", "CREATE BOM"] }}
            onCellUpdate={handleCellUpdate}
            hiddenColumns={["ITEM SCHEDULE NAME", "C BATCH"]}
            cellBadges={ITEM_CODE_BADGES}
          />
          */}
          <GMDUpdateTable
            headers={groupedData.headers}
            rows={groupedData.rows}
            ids={groupedData.ids}
            selectedIndex={selectedGroupedIndex}
            onSelect={setSelectedGroupedIndex}
            title="Verify BOM — grouped by ITEM CODE"
            groupByColumn="ITEM CODE"
            mergeColumns={GROUPED_MERGE_COLUMNS}
            fullHeight
          />
        </div>

        <Dialog open={confirmItemName} onOpenChange={setConfirmItemName}>
          <DialogContent className="sm:max-w-130 max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Run ItemName (C) sync?</DialogTitle>
              <DialogDescription>
                Reviewing every row before anything is written.
              </DialogDescription>
            </DialogHeader>

            {itemNamePlan && (
              <div className="grid gap-3 text-xs">
                <div className="grid gap-1.5">
                  <div className="font-semibold">
                    Phase 1 — {itemNamePlan.phase1.tabTitle}
                  </div>
                  <div className="text-muted-foreground">
                    {itemNamePlan.phase1.sheetRows} sheet row(s),{" "}
                    {itemNamePlan.phase1.withToDate} with a TO_DATE,{" "}
                    {itemNamePlan.phase1.withoutToDate} without.
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border border-border rounded px-2.5 py-2">
                    <dt>Will be marked NO USE + C</dt>
                    <dd className="text-right font-mono">
                      {itemNamePlan.phase1.willMark}
                    </dd>
                    <dt>Already NO USE, will gain C</dt>
                    <dd className="text-right font-mono text-rose-600 font-semibold">
                      {itemNamePlan.phase1.willAddBatch}
                    </dd>
                    <dt>Already NO USE + C</dt>
                    <dd className="text-right font-mono">
                      {itemNamePlan.phase1.alreadyCorrect}
                    </dd>
                    <dt>New rows to create</dt>
                    <dd className="text-right font-mono">
                      {itemNamePlan.phase1.willCreate}
                    </dd>
                    <dt className="text-muted-foreground">
                      NO USE but no TO_DATE (left unchanged)
                    </dt>
                    <dd className="text-right font-mono text-muted-foreground">
                      {itemNamePlan.phase1.staleNoUse}
                    </dd>
                    <dt className="text-muted-foreground">Unchanged (blank)</dt>
                    <dd className="text-right font-mono text-muted-foreground">
                      {itemNamePlan.phase1.untouchedBlank}
                    </dd>
                    <dt className="text-muted-foreground">Unchanged (USE)</dt>
                    <dd className="text-right font-mono text-muted-foreground">
                      {itemNamePlan.phase1.use}
                    </dd>
                    {itemNamePlan.phase1.samples.staleBatch.length > 0 && (
                      <>
                        <dt className="text-amber-600">
                          C without NO USE (invariant break)
                        </dt>
                        <dd className="text-right font-mono text-amber-600 font-semibold">
                          {itemNamePlan.phase1.samples.staleBatch.length}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>

                <div className="grid gap-1.5">
                  <div className="font-semibold">
                    Phase 2 — {itemNamePlan.phase2.tabTitle}
                  </div>
                  <div className="text-muted-foreground">
                    {itemNamePlan.phase2.sheetCodes.toLocaleString("en-IN")} code(s)
                    in sheet, {itemNamePlan.phase2.scanned.toLocaleString("en-IN")}{" "}
                    row(s) scanned.
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border border-border rounded px-2.5 py-2">
                    <dt>itemName will change</dt>
                    <dd className="text-right font-mono">
                      {itemNamePlan.phase2.itemNameChanged}
                    </dd>
                    <dt>rmItemName will change</dt>
                    <dd className="text-right font-mono">
                      {itemNamePlan.phase2.rmItemNameChanged}
                    </dd>
                    <dt className="text-muted-foreground">
                      Already identical
                    </dt>
                    <dd className="text-right font-mono text-muted-foreground">
                      {itemNamePlan.phase2.unchanged}
                    </dd>
                    <dt className="text-muted-foreground">Code not in sheet</dt>
                    <dd className="text-right font-mono text-muted-foreground">
                      {itemNamePlan.phase2.unmatched}
                    </dd>
                  </dl>
                </div>

                <p className="text-[11px] text-amber-600 font-semibold">
                  The NO USE mark is one-way — nothing in this app can set it back
                  to USE.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmItemName(false)}
                disabled={syncingItemName}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSyncItemNames}
                disabled={syncingItemName}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {syncingItemName ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Running...
                  </>
                ) : (
                  "Run Sync"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
