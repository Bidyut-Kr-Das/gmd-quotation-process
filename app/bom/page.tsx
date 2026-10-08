"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Database, Loader2, Tags, ChevronDown } from "lucide-react";
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
import { Input } from "@/components/ui/input";

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

type SearchKey = "itemCode" | "itemName" | "rmItemCode" | "rmItemName" | "bomId";
type PickKey = "bomNature" | "bomIdType" | "bomItemNature" | "rmItemNature";

const SEARCH_CARDS: { key: SearchKey; label: string }[] = [
  { key: "itemCode", label: "BOM Item Code" },
  { key: "itemName", label: "BOM Item Name" },
  { key: "rmItemCode", label: "RM Item Code" },
  { key: "rmItemName", label: "RM Item Name" },
  { key: "bomId", label: "BOM ID" },
];

const NATURE_OPTIONS = ["FG", "RM"];

// BOM/RM nature is defined by the first character of the item code: F = FG,
// R = RM.
function itemNature(code: string): string {
  const c = code.trim().charAt(0).toUpperCase();
  return c === "F" ? "FG" : c === "R" ? "RM" : "";
}

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          {selected.length > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-wrap gap-1 px-3 pt-1 pb-3">
        {options.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">No values</span>
        ) : (
          options.map((opt) => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onToggle(opt)}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
                  (active
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                    : "border-border text-muted-foreground hover:bg-accent")
                }
              >
                {opt}
              </button>
            );
          })
        )}
      </div>
    </details>
  );
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
  const [search, setSearch] = useState<Record<SearchKey, string>>({
    itemCode: "",
    itemName: "",
    rmItemCode: "",
    rmItemName: "",
    bomId: "",
  });
  const [picked, setPicked] = useState<Record<PickKey, string[]>>({
    bomNature: [],
    bomIdType: [],
    bomItemNature: [],
    rmItemNature: [],
  });

  const togglePick = useCallback((key: PickKey, value: string) => {
    setPicked((prev) => {
      const cur = prev[key];
      return {
        ...prev,
        [key]: cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value],
      };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setSearch({
      itemCode: "",
      itemName: "",
      rmItemCode: "",
      rmItemName: "",
      bomId: "",
    });
    setPicked({
      bomNature: [],
      bomIdType: [],
      bomItemNature: [],
      rmItemNature: [],
    });
  }, []);

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

  const filterOptions = useMemo(() => {
    const srcRows = data?.rows ?? [];
    const srcHeaders = data?.headers ?? [];
    const uniq = (idx: number): string[] => {
      if (idx < 0) return [];
      const s = new Set<string>();
      for (const row of srcRows) {
        const v = String(row[idx] ?? "").trim();
        if (v) s.add(v);
      }
      return [...s].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    };
    return {
      bomNature: uniq(srcHeaders.indexOf("BOM NATURE")),
      bomIdType: uniq(srcHeaders.indexOf("BOM ID TYPE")),
    };
  }, [data]);

  // Every sidebar filter acts on the BOM, not the row: a BOM is kept when its
  // parent or any of its components matches, then all components of a kept BOM
  // are shown (e.g. select FG and the BOM's FG + RM subs both appear).
  const visibleData = useMemo(() => {
    const srcRows = data?.rows ?? [];
    const srcIds = data?.ids ?? [];
    const srcHeaders = data?.headers ?? [];
    const itemCodeIdx = srcHeaders.indexOf("ITEM CODE");
    const itemNameIdx = srcHeaders.indexOf("ITEM NAME");
    const rmCodeIdx = srcHeaders.indexOf("RM ITEM CODE");
    const rmNameIdx = srcHeaders.indexOf("RM ITEM NAME");
    const bomIdIdx = srcHeaders.indexOf("BOM ID");
    const bomNatureIdx = srcHeaders.indexOf("BOM NATURE");
    const bomIdTypeIdx = srcHeaders.indexOf("BOM ID TYPE");
    const cell = (row: unknown[], idx: number) =>
      idx >= 0 ? String(row[idx] ?? "").trim() : "";
    const has = (value: string, query: string) =>
      value.toLowerCase().includes(query.trim().toLowerCase());

    type Group = {
      bomId: string;
      parentCode: string;
      parentName: string;
      nature: string;
      idType: string;
      comps: { code: string; name: string }[];
      idx: number[];
    };
    const groups = new Map<string, Group>();
    srcRows.forEach((row, i) => {
      const bomId = cell(row, bomIdIdx);
      // A FullItem with no BOM emits a blank BOM ID. Keying on that would merge
      // every no-BOM item into one group, so fall back to its own item code.
      const groupKey = bomId || `__item__${cell(row, itemCodeIdx)}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = {
          bomId,
          parentCode: cell(row, itemCodeIdx),
          parentName: cell(row, itemNameIdx),
          nature: cell(row, bomNatureIdx),
          idType: cell(row, bomIdTypeIdx),
          comps: [],
          idx: [],
        };
        groups.set(groupKey, g);
      }
      if (!g.parentCode) g.parentCode = cell(row, itemCodeIdx);
      if (!g.parentName) g.parentName = cell(row, itemNameIdx);
      if (!g.nature) g.nature = cell(row, bomNatureIdx);
      if (!g.idType) g.idType = cell(row, bomIdTypeIdx);
      g.comps.push({ code: cell(row, rmCodeIdx), name: cell(row, rmNameIdx) });
      g.idx.push(i);
    });

    const keep = new Set<number>();
    for (const g of groups.values()) {
      if (search.itemCode && !has(g.parentCode, search.itemCode)) continue;
      if (search.itemName && !has(g.parentName, search.itemName)) continue;
      if (search.bomId && !has(g.bomId, search.bomId)) continue;
      if (
        search.rmItemCode &&
        !g.comps.some((c) => has(c.code, search.rmItemCode))
      )
        continue;
      if (
        search.rmItemName &&
        !g.comps.some((c) => has(c.name, search.rmItemName))
      )
        continue;
      if (picked.bomNature.length && !picked.bomNature.includes(g.nature))
        continue;
      if (picked.bomIdType.length && !picked.bomIdType.includes(g.idType))
        continue;
      if (
        picked.bomItemNature.length &&
        !picked.bomItemNature.includes(itemNature(g.parentCode))
      )
        continue;
      if (
        picked.rmItemNature.length &&
        !g.comps.some((c) => picked.rmItemNature.includes(itemNature(c.code)))
      )
        continue;
      for (const i of g.idx) keep.add(i);
    }

    const rows: unknown[][] = [];
    const outIds: string[] = [];
    srcRows.forEach((row, i) => {
      if (keep.has(i)) {
        rows.push(row);
        outIds.push(srcIds[i]);
      }
    });
    return { rows, ids: outIds, headers: srcHeaders };
  }, [data, search, picked]);

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
    const srcRows = visibleData.rows;
    const srcIds = visibleData.ids;
    const srcHeaders = visibleData.headers;
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
  }, [visibleData]);

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
      <div className="flex-1 flex min-h-0">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-muted/20">
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Search &amp; Filters</span>
              <span className="text-[11px] text-muted-foreground">
                Filters apply per BOM — every component of a matching BOM is
                shown.
              </span>
            </div>
            {SEARCH_CARDS.map((card) => (
              <div key={card.key} className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {card.label}
                </label>
                <Input
                  value={search[card.key]}
                  onChange={(e) =>
                    setSearch((prev) => ({
                      ...prev,
                      [card.key]: e.target.value,
                    }))
                  }
                  placeholder={`Search ${card.label}...`}
                />
              </div>
            ))}
            <FilterDropdown
              label="BOM Nature"
              options={filterOptions.bomNature}
              selected={picked.bomNature}
              onToggle={(v) => togglePick("bomNature", v)}
            />
            <FilterDropdown
              label="BOM ID Type"
              options={filterOptions.bomIdType}
              selected={picked.bomIdType}
              onToggle={(v) => togglePick("bomIdType", v)}
            />
            <FilterDropdown
              label="BOM Item Nature"
              options={NATURE_OPTIONS}
              selected={picked.bomItemNature}
              onToggle={(v) => togglePick("bomItemNature", v)}
            />
            <FilterDropdown
              label="RM Item Nature"
              options={NATURE_OPTIONS}
              selected={picked.rmItemNature}
              onToggle={(v) => togglePick("rmItemNature", v)}
            />
            <Button variant="outline" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </aside>
        <div className="flex-1 flex flex-col p-6 min-h-0 min-w-0">
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
              className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-400 dark:text-emerald-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="flex items-center gap-1.5 bg-[#38ef7d]/10 hover:bg-[#38ef7d]/20 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 border border-[#38ef7d]/40 dark:border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-[#38ef7d] dark:text-emerald-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
              className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-amber-400 dark:text-amber-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
          <div className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</div>
        )}
        <div className="flex-1 overflow-y-auto min-h-0 min-w-0 flex flex-col gap-4 pr-1 mt-4">
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
            diffHighlight={{ columns: ["ITEM NAME", "NEW ITEM NAME"], tone:"amber" }}
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
                    <dd className="text-right font-mono text-rose-600 dark:text-rose-300 font-semibold">
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
                        <dt className="text-amber-600 dark:text-amber-300">
                          C without NO USE (invariant break)
                        </dt>
                        <dd className="text-right font-mono text-amber-600 dark:text-amber-300 font-semibold">
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

                <p className="text-[11px] text-amber-600 dark:text-amber-300 font-semibold">
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
                className="bg-amber-500 dark:bg-amber-500/25 hover:bg-amber-600 dark:hover:bg-amber-500/35 text-white dark:text-amber-100"
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
      </div>
    </main>
  );
}
