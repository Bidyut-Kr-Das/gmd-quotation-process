"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnSizingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortIndicator } from "./filters/sort-indicator";
import { SearchFilter } from "./filters/search-filter";
import { ColumnPicker } from "./filters/column-picker";

/* ---------- helper: use controlled or internal state ---------- */
function useControllable<T>(
  controlledValue: T | undefined,
  controlledOnChange: ((val: T) => void) | undefined,
  defaultValue: T,
): [T, (updater: T | ((prev: T) => T)) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internal;
  const ref = useRef(value);
  ref.current = value;

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const next =
        typeof updater === "function"
          ? (updater as (prev: T) => T)(ref.current)
          : updater;
      if (controlledOnChange) controlledOnChange(next);
      if (!isControlled) setInternal(next);
    },
    [controlledOnChange, isControlled],
  );

  return [value, setValue];
}

/* ---------- types ---------- */
const PAGE_SIZES_DEFAULT = [20, 50, 100];

export interface DataTableProps<TData> {
  /* ---- data ---- */
  columns: ColumnDef<TData, any>[];
  data: TData[];

  /* ---- header ---- */
  title?: string;
  subtitle?: ReactNode;
  /** Icon rendered before the title — defaults to a table grid icon */
  titleIcon?: ReactNode;

  /* ---- toolbar slots ---- */
  /** Rendered between search and column picker */
  toolbarCenter?: ReactNode;
  /** Rendered after column picker (right side, separated by border) */
  toolbarActions?: ReactNode;
  /** Show the built-in search input (default true) */
  showSearch?: boolean;
  /** Show the built-in column picker (default true) */
  showColumnPicker?: boolean;

  /* ---- header filter slots ---- */
  /**
   * Map of column ID → ReactNode to render inside the header cell.
   * The node is placed after the sort indicator, inside the header flex row.
   */
  headerFilters?: Record<string, ReactNode>;

  /* ---- table config ---- */
  pageSizes?: number[];
  defaultPageSize?: number;
  maxHeight?: string;
  emptyMessage?: string;
  /** Full custom empty state (when data array is empty) */
  emptyState?: ReactNode;
  /** Format column ID to display header text */
  formatHeader?: (columnId: string) => string;

  /* ---- controlled state (optional) ---- */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  globalFilter?: string;
  onGlobalFilterChange?: (filter: string) => void;
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: (sizing: ColumnSizingState) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
}

/* ---------- default title icon ---------- */
const DefaultTitleIcon = () => (
  <div className="flex items-center justify-center w-6 h-6 rounded-sm bg-white/10 shrink-0">
    <svg
      className="size-3.5"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M10.875 12c-.621 0-1.125.504-1.125 1.125M12 12c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M12 15.375c-.621 0-1.125-.504-1.125-1.125v-1.5"
      />
    </svg>
  </div>
);

/* ================================================================
   DataTable component
   ================================================================ */
export function DataTable<TData>({
  columns,
  data,
  title,
  subtitle,
  titleIcon,
  toolbarCenter,
  toolbarActions,
  showSearch = true,
  showColumnPicker = true,
  headerFilters,
  pageSizes = PAGE_SIZES_DEFAULT,
  defaultPageSize = 50,
  maxHeight = "65vh",
  emptyMessage = "No results match your search.",
  emptyState,
  formatHeader: formatHeaderProp,

  sorting: sortingProp,
  onSortingChange: onSortingChangeProp,
  globalFilter: globalFilterProp,
  onGlobalFilterChange: onGlobalFilterChangeProp,
  columnSizing: columnSizingProp,
  onColumnSizingChange: onColumnSizingChangeProp,
  columnVisibility: columnVisibilityProp,
  onColumnVisibilityChange: onColumnVisibilityChangeProp,
}: DataTableProps<TData>) {
  /* ---- controllable state ---- */
  const [sorting, setSorting] = useControllable<SortingState>(
    sortingProp,
    onSortingChangeProp,
    [],
  );
  const [globalFilter, setGlobalFilter] = useControllable<string>(
    globalFilterProp,
    onGlobalFilterChangeProp,
    "",
  );
  const [columnSizing, setColumnSizing] = useControllable<ColumnSizingState>(
    columnSizingProp,
    onColumnSizingChangeProp,
    {},
  );
  const [columnVisibility, setColumnVisibility] =
    useControllable<VisibilityState>(
      columnVisibilityProp,
      onColumnVisibilityChangeProp,
      {},
    );

  /* ---- format header ---- */
  const formatHeader = formatHeaderProp ?? ((id: string) => id);

  /* ---- table instance ---- */
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: (updater) =>
      setSorting(
        typeof updater === "function" ? updater(sorting) : updater,
      ),
    onGlobalFilterChange: (updater) =>
      setGlobalFilter(
        typeof updater === "function" ? updater(globalFilter) : updater,
      ),
    onColumnSizingChange: (updater) =>
      setColumnSizing(
        typeof updater === "function" ? updater(columnSizing) : updater,
      ),
    onColumnVisibilityChange: (updater) =>
      setColumnVisibility(
        typeof updater === "function" ? updater(columnVisibility) : updater,
      ),
    state: {
      sorting,
      globalFilter,
      columnSizing,
      columnVisibility,
    },
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 60,
      maxSize: 800,
    },
    initialState: {
      pagination: { pageSize: defaultPageSize },
    },
    globalFilterFn: "includesString",
  });

  const isResizing = !!table.getState().columnSizingInfo.isResizingColumn;

  /* ---- empty data state ---- */
  if (data.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    return (
      <div className="flex items-center justify-center rounded-sm border border-slate-200 bg-white p-12 text-sm text-slate-400">
        No data available
      </div>
    );
  }

  /* ---- render ---- */
  return (
    <div className="rounded-sm border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ======== TOOLBAR ======== */}
      <div className="bg-white px-5 py-3 text-primary flex items-center justify-between gap-4">
        {/* left: title */}
        <div className="flex items-center gap-3 min-w-0">
          {titleIcon ?? <DefaultTitleIcon />}
          <div className="min-w-0">
            {title && (
              <p className="text-sm font-semibold text-primary tracking-wide truncate">
                {title}
              </p>
            )}
            {subtitle && <p className="text-[11px]">{subtitle}</p>}
          </div>
        </div>

        {/* right: controls */}
        <div className="flex items-center gap-2 shrink-0">
          {showSearch && (
            <SearchFilter value={globalFilter} onChange={setGlobalFilter} />
          )}
          {toolbarCenter}
          {showColumnPicker && (
            <ColumnPicker table={table} formatHeader={formatHeader} />
          )}
          {toolbarActions && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              {toolbarActions}
            </div>
          )}
        </div>
      </div>

      {/* ======== TABLE ======== */}
      <div
        className={cn(
          "overflow-auto",
          isResizing && "select-none",
        )}
        style={{ maxHeight }}
      >
        <table
          className="border-collapse w-full"
          style={{ tableLayout: "fixed", minWidth: "max-content" }}
        >
          <colgroup>
            {table.getAllLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="h-10">
                {headerGroup.headers.map((header) => {
                  const colId = header.column.id;
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(
                        "bg-brand h-10 text-white text-[11px] font-semibold overflow-hidden uppercase tracking-wider",
                        "px-3 py-2 text-left border-b border-r border-brand last:border-r-0",
                        "truncate relative group",
                        header.column.getCanSort() &&
                          "cursor-pointer select-none",
                      )}
                      style={{ width: header.getSize() }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1.5">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {header.column.getCanSort() && (
                          <SortIndicator header={header} />
                        )}
                        {headerFilters?.[colId]}
                      </div>

                      {header.column.getCanResize() && (
                        <div
                          onDoubleClick={() => header.column.resetSize()}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize rounded-full",
                            "group-hover:bg-primary/20 active:bg-primary/30",
                          )}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getAllLeafColumns().length}
                  className="h-24 text-center text-sm text-slate-400"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "transition-colors h-[52px]",
                    "hover:bg-slate-100/50",
                    "bg-white",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "px-3 py-0 text-xs text-slate-600 border-b border-r border-slate-200 last:border-r-0",
                        "whitespace-normal break-words leading-relaxed overflow-hidden h-[52px]",
                      )}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>

      {/* ======== PAGINATION ======== */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            Showing{" "}
            {table.getState().pagination.pageIndex *
              table.getState().pagination.pageSize +
              1}{" "}
            –{" "}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) *
                table.getState().pagination.pageSize,
              table.getPrePaginationRowModel().rows.length,
            )}{" "}
            of {table.getPrePaginationRowModel().rows.length}
          </span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => table.setPageSize(Number(v))}
          >
            <SelectTrigger size="sm" className="ml-2 h-7 w-auto text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            className="size-7 p-0"
          >
            <ChevronsLeft className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="size-7 p-0"
          >
            <ChevronLeft className="size-3" />
          </Button>
          <span className="text-xs text-slate-500 px-2 min-w-[80px] text-center">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="size-7 p-0"
          >
            <ChevronRight className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            className="size-7 p-0"
          >
            <ChevronsRight className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
