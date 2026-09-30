"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import MultiSelectFilter, { BLANK } from "@/components/table/MultiSelectFilter";
import Pagination from "@/components/table/Pagination";

interface IndentListingTableProps {
  title: string;
  rows: unknown[][];
  ids: string[];
}

interface ColumnDef {
  label: string;
  key: string;
  dataIdx: number;
  numeric: boolean;
  categoryIdx?: number;
  rmCodeIdx?: number;
}

// Display columns. `dataIdx` maps the display index to the raw row index
// (rows carry 17 fields: item, size, pnRating, mcReceivedPending, total, v1..v4,
// then v1Category..v4Category, then rmCodeV1..rmCodeV4; the MC RECEIVED/PENDING
// field is skipped in the UI). V1..V4 hold the BAL BILL AG CONT for each variant
// of the item, derived on recompute, and the matching category is shown beside
// the value and used by the column filter. The RM code resolved from the raw
// material master for that same variant is shown underneath both.
const COLUMNS: ColumnDef[] = [
  { label: "ITEM NAME", key: "item", dataIdx: 0, numeric: false },
  { label: "SIZE", key: "size", dataIdx: 1, numeric: false },
  { label: "PN RATING", key: "pnRating", dataIdx: 2, numeric: false },
  { label: "Total Ag Cont", key: "total", dataIdx: 4, numeric: true },
  { label: "V1", key: "v1", dataIdx: 5, numeric: true, categoryIdx: 9, rmCodeIdx: 13 },
  { label: "V2", key: "v2", dataIdx: 6, numeric: true, categoryIdx: 10, rmCodeIdx: 14 },
  { label: "V3", key: "v3", dataIdx: 7, numeric: true, categoryIdx: 11, rmCodeIdx: 15 },
  { label: "V4", key: "v4", dataIdx: 8, numeric: true, categoryIdx: 12, rmCodeIdx: 16 },
];

// Widths are sized to the content: `item` holds the base item after recompute
// so its longest value is 11 chars ("AIR CUSHION"), and the total is a number
// capped at ~4 digits. V1..V4 stay wider because they stack the balance, the
// category line and a comma-joined RM code.
const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 140,
  1: 110,
  2: 130,
  3: 110,
  4: 150,
  5: 150,
  6: 150,
  7: 150,
};

function cellText(row: unknown[], dataIdx: number): string {
  return String(row[dataIdx] ?? "").trim();
}

// Value used for filtering a column: the category for V1..V4, otherwise the
// cell value itself.
function filterText(row: unknown[], col: ColumnDef): string {
  return cellText(row, col.categoryIdx ?? col.dataIdx);
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

export default function IndentListingTable({
  title,
  rows,
  ids,
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

  const getColWidth = (idx: number) => columnWidths[idx] ?? DEFAULT_COLUMN_WIDTHS[idx] ?? 120;
  const totalTableWidth =
    COLUMNS.reduce((acc, _, idx) => acc + getColWidth(idx), 0);

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
        const col = COLUMNS[colIdx];
        if (!col || colIdx === excludeIdx || selected.length === 0) continue;
        const selectedSet = new Set(selected);
        out = out.filter((row) => {
          const v = filterText(row, col);
          if (selectedSet.has(BLANK)) return v === "";
          return selectedSet.has(v);
        });
      }
      return out;
    },
    [filters],
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
    COLUMNS.forEach((col, idx) => {
      const scoped = applyFilters(idx, rows);
      const valueCounts = new Map<string, number>();
      for (const row of scoped) {
        const v = filterText(row, col);
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
  }, [applyFilters, rows, filters]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    if (sortIdx !== null) {
      const col = COLUMNS[sortIdx];
      out.sort((a, b) => {
        const av = cellText(a, col.dataIdx).toLowerCase();
        const bv = cellText(b, col.dataIdx).toLowerCase();
        const cmp = compareCell(av, bv, col.numeric);
        return sortAsc ? cmp : -cmp;
      });
    }
    return out;
  }, [filtered, sortIdx, sortAsc]);

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
      <span className="text-[#0f62fe] dark:text-blue-400">{sortAsc ? "↑" : "↓"}</span>
    ) : null;

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  // V1..V4 stack three lines: the balance, the variant category it came from,
  // and the RM code resolved from the raw material master for that variant.
  const renderCell = (row: unknown[], col: ColumnDef) => {
    const value = String(row[col.dataIdx] ?? "").trim();
    const category =
      col.categoryIdx === undefined
        ? ""
        : String(row[col.categoryIdx] ?? "").trim();
    const rmCode =
      col.rmCodeIdx === undefined
        ? ""
        : String(row[col.rmCodeIdx] ?? "").trim();

    if (value === "") return "—";
    if (category === "" && rmCode === "") return value;

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
        {rmCode !== "" && (
          <span className="text-[10px] font-mono font-medium text-[#0f62fe] dark:text-blue-400">
            {rmCode}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {title} · {filtered.length} of {rows.length} rows
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full min-w-0 border-b border-border">
        <table
          ref={tableRef}
          className="border-collapse text-left border border-border"
          style={{ tableLayout: "fixed", width: totalTableWidth }}
        >
          <colgroup>
            {COLUMNS.map((_, idx) => (
              <col key={idx} style={{ width: getColWidth(idx) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-muted select-none">
              {COLUMNS.map((col, idx) => (
                <th
                  key={col.key}
                  aria-sort={
                    sortIdx === idx
                      ? sortAsc
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0"
                >
                  {/* Full-cell sort target. It sits beneath the label and the
                      filter so both keep their own clicks, and stays a real
                      <button> so keyboard and screen reader users can still
                      reach it — unlike an onClick on the <th> itself. */}
                  <button
                    type="button"
                    onClick={() => handleSort(idx)}
                    aria-label={`Sort by ${col.label}`}
                    className="absolute inset-0 z-0 cursor-pointer transition-colors hover:bg-muted/60"
                  />

                  <div className="relative z-10 flex items-center justify-between gap-1 pointer-events-none">
                    <span className="font-bold uppercase tracking-wider">
                      {col.label}
                    </span>
                    {sortArrow(idx)}
                  </div>

                  <div className="relative z-20 mt-1.5 normal-case font-normal text-left text-foreground">
                    <MultiSelectFilter
                      label={col.label}
                      allLabel={`${col.label}: All`}
                      options={cascadedOptions[idx] ?? []}
                      cascadedOptions={cascadedOptions[idx] ?? []}
                      counts={cascadedCounts[idx] ?? {}}
                      selected={filters[idx] ?? []}
                      onChange={(v) =>
                        setFilters((prev) => ({ ...prev, [idx]: v }))
                      }
                      includeBlank
                    />
                  </div>
                  <div
                    onMouseDown={(e) => handleMouseDown(idx, e)}
                    className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-30 group"
                    style={{ marginRight: "-3px" }}
                  >
                    <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                    <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-background">
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="py-20 px-4 text-center border-b border-border"
                >
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
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
                    {COLUMNS.map((col, idx) => (
                      <td
                        key={col.key}
                        className={`py-2.5 px-4 text-xs border-r border-b border-border last:border-r-0 ${
                          col.rmCodeIdx === undefined ? "truncate" : ""
                        } ${
                          col.numeric
                            ? "font-bold text-foreground text-right tabular-nums"
                            : "text-muted-foreground"
                        } ${idx === 0 ? "font-semibold text-foreground" : ""}`}
                      >
                        {renderCell(row, col)}
                      </td>
                    ))}
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