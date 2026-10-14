"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { updateIndentRmCodeAction } from "@/app/actions";
import MultiSelectFilter, { BLANK } from "@/components/table/MultiSelectFilter";
import Pagination from "@/components/table/Pagination";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { VariantMetrics } from "@/lib/indentListingMetrics";

interface IndentListingTableProps {
  title: string;
  rows: unknown[][];
  ids: string[];
  /** Per-row, per-variant metrics aligned with `rows`. */
  metrics: VariantMetrics[][];
  /** Stored-row ids behind each displayed row, aligned with `rows`. */
  sourceIds: string[][];
  /** Raw materials offered by the hand-pick RM code dropdown. */
  rmOptions: { code: string; name: string }[];
  /** Re-fetch the listing after a hand-picked RM code is saved. */
  onRefresh: () => void;
}

// Row layout (17 fields) produced by `lib/indentListingRead.ts`:
//   item, size, pnRating, mcReceivedPending, total,
//   v1..v4, v1Category..v4Category, rmCodeV1..rmCodeV4
const STATUS_IDX = 3;
const V_VALUE_IDXS = [5, 6, 7, 8];
const V_CAT_IDXS = [9, 10, 11, 12];
const V_RM_IDXS = [13, 14, 15, 16];

type VariantMetricKey =
  | "mcReceived"
  | "mcPending"
  | "stock"
  | "catValue"
  | "orderedQty"
  | "pendingOrderQty";

interface BaseColumn {
  kind: "base";
  label: string;
  key: string;
  dataIdx: number;
  numeric: boolean;
  width: number;
}

interface VariantColumn {
  kind: "variant";
  label: string;
  key: string;
  slot: number;
  slotLabel: string;
  metric: VariantMetricKey;
  numeric: boolean;
  width: number;
  valueIdx?: number;
  categoryIdx?: number;
  rmCodeIdx?: number;
}

type LeafColumn = BaseColumn | VariantColumn;

const BASE_COLUMNS: BaseColumn[] = [
  { kind: "base", label: "ITEM NAME", key: "item", dataIdx: 0, numeric: false, width: 150 },
  { kind: "base", label: "SIZE", key: "size", dataIdx: 1, numeric: false, width: 100 },
  { kind: "base", label: "PN RATING", key: "pnRating", dataIdx: 2, numeric: false, width: 120 },
  { kind: "base", label: "MC RECEIVED/PENDING", key: "mcStatus", dataIdx: STATUS_IDX, numeric: false, width: 150 },
  { kind: "base", label: "Total Ag Cont", key: "total", dataIdx: 4, numeric: true, width: 120 },
];

// The subcolumns every V1..V4 block repeats. `catValue` is the existing balance
// cell: the value with `-(category)` beside it and the resolved RM code below.
const VARIANT_SUBS: { metric: VariantMetricKey; label: string; width: number }[] = [
  { metric: "stock", label: "STOCK", width: 90 },
  { metric: "catValue", label: "CATEGORY / VALUE", width: 150 },
  { metric: "orderedQty", label: "ORDERED QTY", width: 100 },
  { metric: "pendingOrderQty", label: "PENDING ORDER QTY", width: 120 },
];

const VARIANT_GROUPS = ["V1", "V2", "V3", "V4"];

const VARIANT_COLUMNS: VariantColumn[] = VARIANT_GROUPS.flatMap(
  (slotLabel, slot) =>
    VARIANT_SUBS.map((sub) => ({
      kind: "variant" as const,
      label: sub.label,
      key: `${slotLabel}-${sub.metric}`,
      slot,
      slotLabel,
      metric: sub.metric,
      numeric: true,
      width: sub.width,
      ...(sub.metric === "catValue"
        ? {
            valueIdx: V_VALUE_IDXS[slot],
            categoryIdx: V_CAT_IDXS[slot],
            rmCodeIdx: V_RM_IDXS[slot],
          }
        : {}),
    })),
);

const LEAF_COLUMNS: LeafColumn[] = [...BASE_COLUMNS, ...VARIANT_COLUMNS];

const DEFAULT_COLUMN_WIDTHS: Record<number, number> = Object.fromEntries(
  LEAF_COLUMNS.map((col, idx) => [idx, col.width]),
);

function cellText(row: unknown[], idx: number): string {
  return String(row[idx] ?? "").trim();
}

// The value shown (and sorted) in a leaf column. Variant metrics come from the
// per-row `VariantMetrics`; `catValue` falls back to the balance in the row.
function leafValue(
  row: unknown[],
  col: LeafColumn,
  metrics?: VariantMetrics[],
): string {
  if (col.kind === "base") return cellText(row, col.dataIdx);
  if (col.metric === "catValue")
    return col.valueIdx === undefined ? "" : cellText(row, col.valueIdx);
  return metrics?.[col.slot]?.[col.metric] ?? "";
}

// Value used for filtering: the category for the `catValue` subcolumn (matching
// the previous V-column behaviour), otherwise the displayed value.
function leafFilterText(
  row: unknown[],
  col: LeafColumn,
  metrics?: VariantMetrics[],
): string {
  if (col.kind === "variant" && col.metric === "catValue")
    return col.categoryIdx === undefined ? "" : cellText(row, col.categoryIdx);
  return leafValue(row, col, metrics);
}

function compareCell(a: string, b: string, numeric: boolean): number {
  if (a === b) return 0;
  if (numeric) {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    const aNaN = Number.isNaN(an);
    const bNaN = Number.isNaN(bn);
    if (aNaN && bNaN) return a.localeCompare(b, undefined, { numeric: true });
    if (aNaN) return 1; // blanks/non-numeric last
    if (bNaN) return -1;
    return an - bn;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

// Keeps the hand-picked RM code inside this leaf and commits upward after 300ms, so
// rapid picks do not fire overlapping writes/refreshes with a stale value.
function RmCodeCell({
  label,
  options,
  optionLabels,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  optionLabels: Record<string, string>;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const selectedKey = JSON.stringify(selected);
  const [local, setLocal] = useState(selected);
  const [prevKey, setPrevKey] = useState(selectedKey);
  const debounced = useDebounce(local, 300);
  const isPickingRef = useRef(false);

  // Adjust during render rather than in an effect, so a refresh from outside shows in
  // the dropdown on the same commit instead of one render later.
  if (selectedKey !== prevKey) {
    setPrevKey(selectedKey);
    setLocal(selected);
  }

  // An incoming value means the change came from outside, not from picking here. Without
  // this the still-pending debounced pick would be committed back and bounce the selection.
  useEffect(() => {
    isPickingRef.current = false;
  }, [selectedKey]);

  useEffect(() => {
    if (isPickingRef.current && JSON.stringify(debounced) !== selectedKey)
      onChange(debounced);
  }, [debounced, selectedKey, onChange]);

  return (
    <MultiSelectFilter
      label={label}
      allLabel="—"
      options={options}
      cascadedOptions={options}
      optionLabels={optionLabels}
      selected={local}
      onChange={(vals) => {
        isPickingRef.current = true;
        setLocal(vals);
      }}
      renderButtonLabel={(sel) => (sel.length > 0 ? sel.join(", ") : "—")}
      align="end"
      className="h-5 w-auto max-w-full gap-1 border-0 bg-transparent px-1 py-0 text-[10px] font-mono font-medium normal-case text-[#0f62fe] hover:bg-[#0f62fe]/10 dark:text-primary"
    />
  );
}

export default function IndentListingTable({
  title,
  rows,
  ids,
  metrics,
  sourceIds,
  rmOptions,
  onRefresh,
}: IndentListingTableProps) {
  const [sortIdx, setSortIdx] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filters, setFilters] = useState<Record<number, string[]>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const tableRef = useRef<HTMLTableElement>(null);

  const getColWidth = (idx: number) =>
    columnWidths[idx] ?? DEFAULT_COLUMN_WIDTHS[idx] ?? 120;
  const totalTableWidth = LEAF_COLUMNS.reduce(
    (acc, _, idx) => acc + getColWidth(idx),
    0,
  );

  // Row reference -> its per-variant metrics. The family merge clones rows but
  // keeps object identity, so filtering/sorting can look metrics up by row.
  const metricsByRow = useMemo(() => {
    const map = new Map<unknown[], VariantMetrics[]>();
    rows.forEach((row, i) => map.set(row, metrics[i] ?? []));
    return map;
  }, [rows, metrics]);

  const getMetrics = useCallback(
    (row: unknown[]) => metricsByRow.get(row),
    [metricsByRow],
  );

  // Row reference -> its stored source ids, so an edit reaches every DB row the
  // displayed (possibly merged or synthesized) line is built from.
  const sourceIdsByRow = useMemo(() => {
    const map = new Map<unknown[], string[]>();
    rows.forEach((row, i) => map.set(row, sourceIds[i] ?? []));
    return map;
  }, [rows, sourceIds]);

  const rmCodes = useMemo(() => rmOptions.map((o) => o.code), [rmOptions]);
  const rmOptionLabels = useMemo(
    () => Object.fromEntries(rmOptions.map((o) => [o.code, `${o.code} — ${o.name}`])),
    [rmOptions],
  );

  const handleRmCodeChange = useCallback(
    async (row: unknown[], slot: number, value: string) => {
      const targets = sourceIdsByRow.get(row) ?? [];
      if (targets.length === 0) return;
      const res = await updateIndentRmCodeAction({
        sourceIds: targets,
        slot: (slot + 1) as 1 | 2 | 3 | 4,
        value,
      });
      if (res.success) onRefresh();
      else toast.error(res.error ?? "Failed to update the RM code.");
    },
    [sourceIdsByRow, onRefresh],
  );

  // Mouse drag handler for column resizing. Paints straight to the DOM during
  // the drag and commits the width once on mouseup.
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getColWidth(columnIndex);
    let latestWidth = startWidth;

    const table = tableRef.current;
    const col = table?.querySelectorAll(
      "colgroup > col",
    )[columnIndex] as HTMLElement | undefined;
    const startTotalWidth = table ? parseFloat(table.style.width) || 0 : 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      latestWidth = Math.max(60, startWidth + deltaX);
      if (col) col.style.width = `${latestWidth}px`;
      if (table)
        table.style.width = `${startTotalWidth + (latestWidth - startWidth)}px`;
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (latestWidth !== startWidth) {
        setColumnWidths((prev) => ({ ...prev, [columnIndex]: latestWidth }));
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Apply every active filter except `excludeIdx`. Used both for the visible
  // rows (excludeIdx = -1) and to compute each column's cascading options.
  const applyFilters = useCallback(
    (excludeIdx: number, source: unknown[][]) => {
      let out = source;
      for (const [colIdxStr, selected] of Object.entries(filters)) {
        const colIdx = Number(colIdxStr);
        const col = LEAF_COLUMNS[colIdx];
        if (!col || colIdx === excludeIdx || selected.length === 0) continue;
        const selectedSet = new Set(selected);
        out = out.filter((row) => {
          const v = leafFilterText(row, col, getMetrics(row));
          if (selectedSet.has(BLANK)) return v === "";
          return selectedSet.has(v);
        });
      }
      return out;
    },
    [filters, getMetrics],
  );

  const filtered = useMemo(
    () => applyFilters(-1, rows),
    [applyFilters, rows],
  );

  // Cascading options/counts: each column offers only the values present among
  // rows matching all other active filters (plus its own current selection, so
  // a selected value can still be deselected).
  const { cascadedOptions, cascadedCounts } = useMemo(() => {
    const options: Record<number, string[]> = {};
    const counts: Record<number, Record<string, number>> = {};
    LEAF_COLUMNS.forEach((col, idx) => {
      const scoped = applyFilters(idx, rows);
      const valueCounts = new Map<string, number>();
      for (const row of scoped) {
        const v = leafFilterText(row, col, getMetrics(row));
        valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
      }
      const selectedSet = new Set(filters[idx] ?? []);
      for (const v of selectedSet) {
        if (v === BLANK) continue;
        if (!valueCounts.has(v)) valueCounts.set(v, 0);
      }
      options[idx] = [...valueCounts.keys()]
        .filter((v) => v !== "")
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      counts[idx] = Object.fromEntries(valueCounts);
    });
    return { cascadedOptions: options, cascadedCounts: counts };
  }, [applyFilters, rows, filters, getMetrics]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    if (sortIdx !== null) {
      const col = LEAF_COLUMNS[sortIdx];
      out.sort((a, b) => {
        const av = leafValue(a, col, getMetrics(a)).toLowerCase();
        const bv = leafValue(b, col, getMetrics(b)).toLowerCase();
        const cmp = compareCell(av, bv, col.numeric);
        return sortAsc ? cmp : -cmp;
      });
    }
    return out;
  }, [filtered, sortIdx, sortAsc, getMetrics]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const sortedIds = useMemo(() => {
    if (sorted.length === 0) return [];
    const idByRow = new Map<unknown[], string>();
    rows.forEach((r, i) => idByRow.set(r, ids[i]));
    const out: string[] = [];
    for (const r of sorted) out.push(idByRow.get(r) ?? "");
    return out;
  }, [sorted, rows, ids]);

  const handleSort = (idx: number) => {
    if (sortIdx === idx) {
      setSortAsc((prev) => !prev);
    } else {
      setSortIdx(idx);
      setSortAsc(true);
    }
  };

  const sortArrow = (idx: number) =>
    sortIdx === idx ? (
      <span className="text-[#0f62fe] dark:text-primary">{sortAsc ? "↑" : "↓"}</span>
    ) : null;

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  // Base and variant cells. The `catValue` subcolumn stacks three lines: the
  // balance, the variant category, and the RM code resolved for that variant.
  const renderCell = (row: unknown[], col: LeafColumn) => {
    if (col.kind === "base") {
      const value = cellText(row, col.dataIdx);
      return value === "" ? "—" : value;
    }

    if (col.metric === "catValue") {
      const value = col.valueIdx === undefined ? "" : cellText(row, col.valueIdx);
      const category =
        col.categoryIdx === undefined ? "" : cellText(row, col.categoryIdx);
      const rmCode =
        col.rmCodeIdx === undefined ? "" : cellText(row, col.rmCodeIdx);
      const targets = sourceIdsByRow.get(row) ?? [];

      if (value === "") return "—";
      if (category === "" && rmCode === "" && targets.length === 0) return value;

      return (
        <span className="flex flex-col items-end gap-0.5">
          <span className="inline-flex items-baseline justify-end gap-1">
            <span>{value}</span>
            {category !== "" && (
              <span className="text-[10px] font-medium text-muted-foreground">
                -({category})
              </span>
            )}
          </span>
          {targets.length > 0 ? (
            // Stored rows exist behind this line, so the code is hand-pickable.
            <RmCodeCell
              label={`${col.slotLabel} RM code`}
              options={rmCodes}
              optionLabels={rmOptionLabels}
              selected={
                rmCode === ""
                  ? []
                  : rmCode
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
              }
              onChange={(vals) => handleRmCodeChange(row, col.slot, vals.join(", "))}
            />
          ) : rmCode !== "" ? (
            <span className="text-[10px] font-mono font-medium text-[#0f62fe] dark:text-primary">
              {rmCode}
            </span>
          ) : null}
        </span>
      );
    }

    const value = getMetrics(row)?.[col.slot]?.[col.metric] ?? "";
    return value === "" ? "—" : value;
  };

  const headerControls = (col: LeafColumn, idx: number) => {
    const prefix = col.kind === "variant" ? `${col.slotLabel} ` : "";
    return (
      <>
        {/* Full-cell sort target. It sits beneath the label and the filter so
            both keep their own clicks, and stays a real <button> so keyboard and
            screen reader users can still reach it — unlike an onClick on the
            <th> itself. */}
        <button
          type="button"
          onClick={() => handleSort(idx)}
          aria-label={`Sort by ${prefix}${col.label}`.trim()}
          className="absolute inset-0 z-0 cursor-pointer transition-colors hover:bg-muted/60"
        />

        <div className="relative z-10 flex items-center justify-between gap-1 pointer-events-none">
          <span className="font-bold uppercase tracking-wider">{col.label}</span>
          {sortArrow(idx)}
        </div>

        <div className="relative z-20 mt-1.5 normal-case font-normal text-left text-foreground">
          <MultiSelectFilter
            label={`${prefix}${col.label}`.trim()}
            allLabel={`${prefix}${col.label}: All`.trim()}
            options={cascadedOptions[idx] ?? []}
            cascadedOptions={cascadedOptions[idx] ?? []}
            counts={cascadedCounts[idx] ?? {}}
            selected={filters[idx] ?? []}
            onChange={(v) => setFilters((prev) => ({ ...prev, [idx]: v }))}
            includeBlank
          />
        </div>
        <div
          onMouseDown={(e) => handleMouseDown(idx, e)}
          className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-30 group"
          style={{ marginRight: "-3px" }}
        >
          <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
          <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] dark:group-hover:bg-primary group-active:bg-[#0f62fe] dark:group-active:bg-primary transition-colors" />
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-muted/50 border-b border-slate-300 dark:border-slate-600">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {title} · {filtered.length} of {rows.length} rows
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/12 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full min-w-0 border-b border-slate-300 dark:border-slate-600">
        <table
          ref={tableRef}
          className="border-collapse text-left border border-slate-400 dark:border-slate-600"
          style={{ tableLayout: "fixed", width: totalTableWidth }}
        >
          <colgroup>
            {LEAF_COLUMNS.map((_, idx) => (
              <col key={idx} style={{ width: getColWidth(idx) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-muted select-none">
              {BASE_COLUMNS.map((col, idx) => (
                <th
                  key={col.key}
                  rowSpan={2}
                  aria-sort={
                    sortIdx === idx
                      ? sortAsc
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b-2 border-slate-300 dark:border-slate-600 last:border-r-0"
                >
                  {headerControls(col, idx)}
                </th>
              ))}
              {VARIANT_GROUPS.map((label) => (
                <th
                  key={label}
                  colSpan={VARIANT_SUBS.length}
                  className="sticky top-0 z-30 h-8 bg-muted/80 text-center text-[11px] font-bold tracking-wider text-foreground uppercase border-r border-b border-slate-300 dark:border-slate-600"
                >
                  {label}
                </th>
              ))}
            </tr>
            <tr className="bg-muted select-none">
              {VARIANT_COLUMNS.map((col, i) => {
                const idx = BASE_COLUMNS.length + i;
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      sortIdx === idx
                        ? sortAsc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="relative py-2.5 px-3 sticky top-8 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b-2 border-slate-300 dark:border-slate-600 last:border-r-0"
                  >
                    {headerControls(col, idx)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-background">
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={LEAF_COLUMNS.length}
                  className="py-20 px-4 text-center border-b border-slate-300 dark:border-slate-600"
                >
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-slate-300 dark:border-slate-600">
                      <Search className="h-6 w-6 stroke-[1.5]" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      No rows found
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                      Try adjusting the filters to see more rows.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row, rowIdx) => {
                const id = sortedIds[(page - 1) * pageSize + rowIdx];
                return (
                  <tr
                    key={id || rowIdx}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    {LEAF_COLUMNS.map((col, idx) => {
                      const isCatValue =
                        col.kind === "variant" && col.metric === "catValue";
                      return (
                        <td
                          key={col.key}
                          className={`py-2.5 px-4 text-xs border-r border-b border-slate-300 dark:border-slate-600 last:border-r-0 ${
                            isCatValue ? "" : "truncate"
                          } ${
                            col.numeric
                              ? "font-bold text-foreground text-right tabular-nums"
                              : "text-muted-foreground"
                          } ${idx === 0 ? "font-semibold text-foreground" : ""}`}
                        >
                          {renderCell(row, col)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalCount={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
