"use client";

import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
  startTransition,
} from "react";
import "./OptimizedTenderTable.css";
import {
  DateRangeColumnFilter,
  SelectColumnFilter,
  TextColumnFilter,
  BooleanColumnFilter,
  DeadlineColumnFilter,
  RawMaterialsColumnFilter,
} from "./filters";
import {
  STATIC_SELECT_SKIP,
  UNIQUE_OPTION_SKIP,
} from "@/lib/tender-filter-meta";
import {
  countRawMaterials,
  anyRawMaterialInRange,
  isAlu,
  isCu,
} from "@/lib/rawMaterials";
import {
  formatDateISTLong,
  toISTDateKey,
  getISTWeekRange,
  getISTMonthRange,
  getISTYearRange,
} from "@/lib/format-ist";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  setColumnFilter,
  clearColumnFilter as clearColumnFilterAction,
  setColumnVisibility,
  resetColumnFilters,
} from "@/lib/slices/filtersSlice";
import {
  Search,
  FileSpreadsheet,
  FileDown,
  FileText,
  Columns3,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  Loader2,
} from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import type {
  ColumnFilterType,
  FilterOption,
  ColumnFilterConfig,
  ColumnFilterState,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export type {
  ColumnFilterType,
  FilterOption,
  ColumnFilterConfig,
  ColumnFilterState,
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface ColumnSearchInputProps {
  value: string;
  placeholder: string;
  onSearch: (text: string) => void;
  onClear: () => void;
}

function DebouncedColumnSearch({
  value,
  placeholder,
  onSearch,
  onClear,
}: ColumnSearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = useCallback(
    (val: string) => {
      setLocal(val);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (val) onSearch(val);
        else onClear();
      }, 300);
    },
    [onSearch, onClear],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <input
      type="text"
      className="column-search-input"
      placeholder={placeholder}
      value={local}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
}

const EMPTY_SELECT_VALUES: string[] = [];



export interface ColumnDef<T> {
  header: string;
  accessor: keyof T | string;
  defaultWidth?: number;
  align?: "left" | "right" | "center";
  type?:
    | "string"
    | "number"
    | "date"
    | "boolean"
    | "percentage"
    | "currency"
    | "status"
    | "decision"
    | "custom";
  filter?: ColumnFilterConfig;
  sortable?: boolean;
  resizable?: boolean;
  searchable?: boolean;
  hidden?: boolean;
  frozen?: boolean;
  renderCell?: (value: unknown, row: T) => React.ReactNode;
  renderExpanded?: (row: T) => React.ReactNode;
  sortValue?: (value: unknown, row: T) => string | number | boolean | null;
  provenance?: Array<"PRE" | "POST" | "NOT_PARTICIPATED">;
}

/**
 * Opt-in server mode. When present the table renders the page it is handed and
 * delegates filtering, sorting, paging and filter options to the caller.
 * Without it the table keeps filtering in memory, which is what /items,
 * /railways and the merge-conflict dashboard still rely on.
 */
export interface ServerTableMode {
  total: number;
  page: number;
  pageSize: number;
  sort: { column: string; direction: "asc" | "desc" } | null;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sort: { column: string; direction: "asc" | "desc" } | null) => void;
  /** Cached options for a column; null until requestFacet resolves. */
  getFacetOptions: (accessor: string) => FilterOption[] | null;
  /** Called when a dropdown opens, so options are fetched on demand. */
  requestFacet: (accessor: string) => void;
  /** Every row the filters match, for the Excel export. */
  getAllFilteredRows: (columns: string[]) => Promise<Record<string, unknown>[]>;
}

export interface OptimizedTenderTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  rows: T[];
  title?: string;
  rowKey?: keyof T;
  onRowClick?: (row: T) => void;
  associations?: { id: number; name: string; email: string }[];
  extraToolbarActions?: React.ReactNode;
  onFilteredRowsChange?: (rows: T[]) => void;
  onParseComplete?: () => void;
  disableDefaultDeadlineFilter?: boolean;
  server?: ServerTableMode;
  /** Show the toolbar "Export Excel" button. Defaults to true. */
  showExport?: boolean;
}

function OptimizedTenderTableInner<T extends Record<string, unknown>>({
  columns,
  rows,
  title = "Data Table",
  rowKey = "id" as keyof T,
  onRowClick,
  associations = [],
  extraToolbarActions,
  onFilteredRowsChange,
  onParseComplete,
  disableDefaultDeadlineFilter = false,
  server,
  showExport = true,
}: OptimizedTenderTableProps<T>) {
  const [globalSearch, setGlobalSearch] = useState<string>("");
  const [localPage, setLocalPage] = useState<number>(1);
  const [localRowsPerPage, setLocalRowsPerPage] = useState<number>(50);

  const debouncedGlobalSearch = useDebouncedValue(globalSearch, 300);

  const [localSortColumn, setLocalSortColumn] = useState<string | null>(null);
  const [localSortDirection, setLocalSortDirection] = useState<"asc" | "desc">("desc");

  // In server mode paging and sorting live with the caller, so the table reads
  // them back instead of keeping a second copy that could drift.
  const currentPage = server ? server.page : localPage;
  const rowsPerPage = server ? server.pageSize : localRowsPerPage;
  const sortColumn = server ? (server.sort?.column ?? null) : localSortColumn;
  const sortDirection = server ? (server.sort?.direction ?? "desc") : localSortDirection;
  const setCurrentPage = server ? server.onPageChange : setLocalPage;
  const setRowsPerPage = server ? server.onPageSizeChange : setLocalRowsPerPage;

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => {
      const initialWidths: Record<string, number> = {};
      columns.forEach((col) => {
        initialWidths[String(col.accessor)] = col.defaultWidth ?? 150;
      });
      return initialWidths;
    },
  );

  useEffect(() => {
    setColumnWidths((prev) => {
      const updated = { ...prev };
      let changed = false;
      for (const col of columns) {
        const key = String(col.accessor);
        if (!(key in updated)) {
          updated[key] = col.defaultWidth ?? 150;
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, [columns]);

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [isDownloadingPdfs, setIsDownloadingPdfs] = useState(false);
  const [isParsingPdfs, setIsParsingPdfs] = useState(false);
  const [isParsingCva, setIsParsingCva] = useState(false);

  const dispatch = useAppDispatch();
  const columnFilters = useAppSelector((s) => s.filters.columnFilters);
  const columnVisibility = useAppSelector((s) => s.filters.columnVisibility);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const resizingColumnRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, accessor: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingColumnRef.current = accessor;
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "col-resize";
    },
    [],
  );

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingColumnRef.current) return;
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(50, startWidthRef.current + diff);
    setColumnWidths((prev) => ({
      ...prev,
      [resizingColumnRef.current!]: newWidth,
    }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingColumnRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
  }, [handleResizeMove]);

  const handleSort = useCallback(
    (accessor: string) => {
      const col = columns.find((c) => String(c.accessor) === accessor);
      if (!col || col.filter?.type === "boolean") return;

      const direction: "asc" | "desc" =
        sortColumn === accessor && sortDirection === "desc" ? "asc" : "desc";

      if (server) {
        server.onSortChange({ column: accessor, direction });
        return;
      }
      setLocalSortColumn(accessor);
      setLocalSortDirection(direction);
      setLocalPage(1);
    },
    [sortColumn, sortDirection, columns, server],
  );

  const toggleRowExpansion = useCallback((keyValue: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [keyValue]: !prev[keyValue],
    }));
  }, []);

  // Stable fallback keys for rows without an id. Math.random() used to be
  // returned here, which produced a different key on every render and forced
  // React to unmount and remount those rows (and discard their DOM) each time.
  const fallbackRowKeys = useRef(new WeakMap<object, string>());
  const fallbackRowSeq = useRef(0);

  const getRowKey = useCallback(
    (row: T): string => {
      const type = row["type" as keyof T];
      const id = row[rowKey];
      if (id !== undefined) {
        return type !== undefined ? `${String(type)}-${String(id)}` : String(id);
      }
      const obj = row as unknown as object;
      let key = fallbackRowKeys.current.get(obj);
      if (key === undefined) {
        key = `__row_${fallbackRowSeq.current++}`;
        fallbackRowKeys.current.set(obj, key);
      }
      return key;
    },
    [rowKey],
  );

  const searchFilteredRows = useMemo(() => {
    // Server mode: rows are already the filtered page.
    if (server) return rows;
    if (debouncedGlobalSearch.trim() === "") return rows;
    const searchLower = debouncedGlobalSearch.toLowerCase().trim();
    return rows.filter((row) => {
      return columns.some((col) => {
        if (col.filter?.type === "boolean") return false;
        const val = row[col.accessor as keyof T];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(searchLower);
      });
    });
  }, [rows, columns, debouncedGlobalSearch, server]);

  const applyColumnFilters = useCallback(
    (baseRows: T[], skipAccessor: string | null): T[] => {
      let result = baseRows;

      columns.forEach((col) => {
        const accessorStr = String(col.accessor);
        if (skipAccessor === accessorStr) return;
        const filterState = columnFilters[accessorStr];
        if (!filterState) return;

        if (accessorStr === "deadline" && filterState.select?.length) {
          const now = new Date();
          const preset = filterState.select[0];
          let fromKey: string | null = null;
          let toKey: string | null = null;
          if (preset === "thisWeek") {
            const r = getISTWeekRange(now);
            fromKey = r.fromKey;
            toKey = r.toKey;
          } else if (preset === "thisMonth") {
            const r = getISTMonthRange(now);
            fromKey = r.fromKey;
            toKey = r.toKey;
          } else if (preset === "thisYear") {
            const r = getISTYearRange(now);
            fromKey = r.fromKey;
            toKey = r.toKey;
          }
          if (fromKey) {
            result = result.filter((row) => {
              const val = row[col.accessor as keyof T];
              if (
                !(val instanceof Date) &&
                typeof val !== "string" &&
                typeof val !== "number"
              )
                return true;
              const key = toISTDateKey(val as any);
              if (!key) return true;
              if (key < fromKey!) return false;
              if (toKey && key > toKey) return false;
              return true;
            });
          }
          return;
        }

        if (col.filter?.type === "dateRange" && filterState.dateRange) {
          const { startDate, endDate } = filterState.dateRange;
          if (startDate || endDate) {
            result = result.filter((row) => {
              const val = row[col.accessor as keyof T];
              if (
                !(val instanceof Date) &&
                typeof val !== "string" &&
                typeof val !== "number"
              )
                return true;

              const key = toISTDateKey(val as any);
              if (!key) return true;

              const fromKey = startDate ? toISTDateKey(startDate) : null;
              const toKey = endDate ? toISTDateKey(endDate) : null;
              // If filter keys are YYYY-MM-DD strings, toISTDateKey handles them; fallback to raw string
              const effectiveFrom = fromKey ?? (startDate ? String(startDate) : null);
              const effectiveTo = toKey ?? (endDate ? String(endDate) : null);
              if (effectiveFrom && key < effectiveFrom) return false;
              if (effectiveTo && key > effectiveTo) return false;

              return true;
            });
          }
        }

        if (col.filter?.type === "select") {
          const selected = filterState.select ?? [];
          if (selected.length > 0) {
            result = result.filter((row) => {
              const rawVal = row[col.accessor as keyof T];
              const val = String(rawVal ?? "");
              if (
                selected.includes("__blank__") &&
                (rawVal === null ||
                  rawVal === undefined ||
                  rawVal === "" ||
                  val === "NOT_DECIDED")
              ) {
                return true;
              }
              if (selected.includes("not_analysed") && val === "") {
                return true;
              }
              if (accessorStr === "assignedTo") {
                const parts = val.split(",").map((s) => s.trim());
                return selected.some((s) => parts.includes(s));
              }
              if (accessorStr === "tenderFileUrl" || accessorStr === "website") {
                if (selected.includes("Available") && val !== "") return true;
                if (selected.includes("Not Available") && val === "") return true;
              }
              return selected.includes(val);
            });
          }
          if (col.filter.searchable && filterState.text) {
            const textLower = filterState.text.toLowerCase();
            result = result.filter((row) => {
              const val = row[col.accessor as keyof T];
              if (val === null || val === undefined) return false;
              return String(val).toLowerCase().includes(textLower);
            });
          }
        }

        if (filterState.text) {
          const textLower = filterState.text.toLowerCase();
          result = result.filter((row) => {
            const val = row[col.accessor as keyof T];
            if (val === null || val === undefined) return false;
            return String(val).toLowerCase().includes(textLower);
          });
        }

        if (
          col.filter?.type === "boolean" &&
          filterState.boolean !== null &&
          filterState.boolean !== undefined
        ) {
          result = result.filter((row) => {
            const val = row[col.accessor as keyof T];
            if (typeof val === "string") {
              return (val === "true") === filterState.boolean;
            }
            return Boolean(val) === filterState.boolean;
          });
        }

        if (col.filter?.type === "rawMaterials" && filterState.rawMaterials) {
          const { aluMin, aluMax, cuMin, cuMax } = filterState.rawMaterials;
          const hasAlu = aluMin.trim() !== "" || aluMax.trim() !== "";
          const hasCu = cuMin.trim() !== "" || cuMax.trim() !== "";
          if (hasAlu || hasCu) {
            const aluRange =
              hasAlu
                ? {
                    min:
                      aluMin.trim() !== ""
                        ? parseFloat(aluMin)
                        : Number.NEGATIVE_INFINITY,
                    max:
                      aluMax.trim() !== ""
                        ? parseFloat(aluMax)
                        : Number.POSITIVE_INFINITY,
                  }
                : null;
            const cuRange =
              hasCu
                ? {
                    min:
                      cuMin.trim() !== ""
                        ? parseFloat(cuMin)
                        : Number.NEGATIVE_INFINITY,
                    max:
                      cuMax.trim() !== ""
                        ? parseFloat(cuMax)
                        : Number.POSITIVE_INFINITY,
                  }
                : null;
            result = result.filter((row) => {
              const raw = row[col.accessor as keyof T];
              if (aluRange) {
                if (!anyRawMaterialInRange(raw, isAlu, aluRange.min, aluRange.max))
                  return false;
              }
              if (cuRange) {
                if (!anyRawMaterialInRange(raw, isCu, cuRange.min, cuRange.max))
                  return false;
              }
              return true;
            });
          }
        }
      });

      return result;
    },
    [columns, columnFilters],
  );

  const processedRows = useMemo(() => {
    if (server) return rows;
    let result = applyColumnFilters(searchFilteredRows, null);

    if (sortColumn) {
      const sortColDef = columns.find((c) => String(c.accessor) === sortColumn);
      const getSortValue = sortColDef?.sortValue ?? ((v: unknown) => v);

      result = [...result].sort((a, b) => {
        if (sortColumn === "rawMaterials") {
          const ca = countRawMaterials(a[sortColumn as keyof T]);
          const cb = countRawMaterials(b[sortColumn as keyof T]);
          if (ca !== cb)
            return sortDirection === "asc" ? ca - cb : cb - ca;
          return 0;
        }

        const valA = getSortValue(a[sortColumn as keyof T], a);
        const valB = getSortValue(b[sortColumn as keyof T], b);

        if (valA === null || valA === undefined)
          return sortDirection === "asc" ? -1 : 1;
        if (valB === null || valB === undefined)
          return sortDirection === "asc" ? 1 : -1;

        if (valA instanceof Date && valB instanceof Date) {
          return sortDirection === "asc"
            ? valA.getTime() - valB.getTime()
            : valB.getTime() - valA.getTime();
        }

        if (typeof valA === "number" && typeof valB === "number") {
          return sortDirection === "asc" ? valA - valB : valB - valA;
        }

        if (typeof valA === "boolean" && typeof valB === "boolean") {
          return sortDirection === "asc"
            ? Number(valA) - Number(valB)
            : Number(valB) - Number(valA);
        }

        const numA = typeof valA === "string" ? parseFloat(valA) : NaN;
        const numB = typeof valB === "string" ? parseFloat(valB) : NaN;
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortDirection === "asc" ? numA - numB : numB - numA;
        }

        return sortDirection === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    const hasDeadlineFilter =
      columnFilters["deadline"]?.select?.length ||
      columnFilters["deadline"]?.dateRange;
    if (!hasDeadlineFilter && !disableDefaultDeadlineFilter) {
      const todayKey = toISTDateKey(new Date());
      result = result.filter((row) => {
        const val = row["deadline" as keyof T];
        if (val == null || val === "") return true;
        if (
          !(val instanceof Date) &&
          typeof val !== "string" &&
          typeof val !== "number"
        )
          return true;
        const key = toISTDateKey(val as any);
        if (!key) return true;
        return key >= (todayKey ?? "");
      });
    }

    return result;
  }, [rows, server, searchFilteredRows, applyColumnFilters, sortColumn, sortDirection, columns, columnFilters, disableDefaultDeadlineFilter]);

  const gemTendersToDownload = useMemo(() => {
    return processedRows
      .filter((row) => {
        const type = row["type" as keyof T];
        const gemId = row["referenceNo" as keyof T];
        const pdfUrl = row["tenderFileUrl" as keyof T];
        return type === "Gem" && !!gemId && !pdfUrl;
      })
      .map((row) => ({
        id: parseInt(String(row["id" as keyof T] ?? "0"), 10),
        gemId: String(row["referenceNo" as keyof T]),
      }));
  }, [processedRows]);

  const tendersToParse = useMemo(() => {
    return processedRows
      .filter((row) => {
        const type = row["type" as keyof T];
        const pdfUrl = row["tenderFileUrl" as keyof T];
        const alreadyParsed = row["itemCategory" as keyof T];
        return type === "Gem" && !!pdfUrl && !alreadyParsed;
      })
      .map((row) => ({
        id: parseInt(String(row["id" as keyof T] ?? "0"), 10),
      }));
  }, [processedRows]);

  const tendersForCvaParsing = useMemo(() => {
    return processedRows
      .filter((row) => {
        const type = row["type" as keyof T];
        const costingUrl = row["costingFileUrl" as keyof T];
        return type === "Gem" && !!costingUrl;
      })
      .map((row) => ({
        id: parseInt(String(row["id" as keyof T] ?? "0"), 10),
        referenceNo: String(row["referenceNo" as keyof T] ?? ""),
        file_link: String(row["costingFileUrl" as keyof T] ?? ""),
      }));
  }, [processedRows]);

  const totalRecords = server ? server.total : processedRows.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;

  const activePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    if (server) return rows;
    const startIndex = (activePage - 1) * rowsPerPage;
    return processedRows.slice(startIndex, startIndex + rowsPerPage);
  }, [server, rows, processedRows, activePage, rowsPerPage]);

  const visibleColumns = useMemo(() => {
    const filtered = columns.filter(
      (col) => !col.hidden && columnVisibility[String(col.accessor)] !== false,
    );
    const frozen = filtered.filter((col) => col.frozen);
    const nonFrozen = filtered.filter((col) => !col.frozen);

    const locIdx = nonFrozen.findIndex(
      (col) => String(col.accessor) === "location",
    );
    const webIdx = nonFrozen.findIndex(
      (col) => String(col.accessor) === "website",
    );
    if (locIdx >= 0 && webIdx >= 0) {
      const [webCol] = nonFrozen.splice(webIdx, 1);
      const newLocIdx = nonFrozen.findIndex(
        (col) => String(col.accessor) === "location",
      );
      nonFrozen.splice(newLocIdx + 1, 0, webCol);
    }

    return [...frozen, ...nonFrozen];
  }, [columns, columnVisibility]);

  const columnPickerOptions = useMemo(
    () =>
      columns
        .filter((c) => !c.hidden)
        .map((c) => ({ value: String(c.accessor), label: c.header })),
    [columns],
  );

  const visibleColumnAccessors = useMemo(
    () =>
      columns
        .filter(
          (c) =>
            !c.hidden && columnVisibility[String(c.accessor)] !== false,
        )
        .map((c) => String(c.accessor)),
    [columns, columnVisibility],
  );

  const handleColumnVisibilityChange = useCallback(
    (next: string[]) => {
      const togglable = columns.filter((c) => !c.hidden);
      const vis: Record<string, boolean> = {};
      togglable.forEach((c) => {
        if (!next.includes(String(c.accessor))) {
          vis[String(c.accessor)] = false;
        }
      });
      // guard: keep at least one visible
      if (
        togglable[0] &&
        vis[String(togglable[0].accessor)] === false
      ) {
        delete vis[String(togglable[0].accessor)];
      }
      dispatch(setColumnVisibility(vis));
    },
    [columns, dispatch],
  );

  const frozenColumnOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let currentLeft = 0;
    for (const col of visibleColumns) {
      if (col.frozen) {
        offsets[String(col.accessor)] = currentLeft;
        currentLeft += columnWidths[String(col.accessor)];
      }
    }
    return offsets;
  }, [visibleColumns, columnWidths]);

  const uniqueSelectOptions = useMemo(() => {
    const map: Record<string, FilterOption[]> = {};
    // Server mode fetches options per column, on demand, from the database.
    if (server) return map;

    // Collect the eligible select columns up front.
    const selectCols: { accessorStr: string; accessor: keyof T }[] = [];
    for (const col of columns) {
      if (col.filter?.type !== "select") continue;
      const accessorStr = String(col.accessor);
      if (UNIQUE_OPTION_SKIP.has(accessorStr)) continue;
      selectCols.push({ accessorStr, accessor: col.accessor as keyof T });
    }
    if (selectCols.length === 0) return map;

    // O(1) association lookup — this used to be an associations.find() per id,
    // per row, per column.
    const assocById = new Map<number, (typeof associations)[number]>();
    for (const a of associations) assocById.set(a.id, a);

    // Cascade except self: a column's options come from rows filtered by every
    // other active filter, never by its own. Columns with no own filter reuse
    // processedRows (already filtered by all other filters) — no extra pass.
    for (const c of selectCols) {
      const rowsForOptions = columnFilters[c.accessorStr]
        ? applyColumnFilters(searchFilteredRows, c.accessorStr)
        : processedRows;
      const seen = new Set<string>();
      const opts: FilterOption[] = [];
      const addOption = (value: string, label?: string) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        opts.push({ value, label: label ?? value });
      };
      for (const row of rowsForOptions) {
        const raw = row[c.accessor];
        if (raw === null || raw === undefined || raw === "") continue;
        if (c.accessorStr === "assignedTo") {
          for (const id of String(raw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)) {
            addOption(id, assocById.get(parseInt(id, 10))?.name);
          }
        } else {
          addOption(String(raw));
        }
      }
      if (opts.length > 0) {
        opts.sort((a, b) => a.label.localeCompare(b.label));
        map[c.accessorStr] = opts;
      }
    }
    return map;
    // ponytail: per-active-column chain re-run; cache skip-variants if filters grow past ~3
  }, [server, columns, searchFilteredRows, processedRows, applyColumnFilters, associations, columnFilters]);

  useEffect(() => {
    // Server mode resets the page where the filters live.
    if (server) return;
    setLocalPage(1);
  }, [server, globalSearch, localRowsPerPage, columnFilters]);

  const onFilteredRowsChangeRef = useRef(onFilteredRowsChange);
  onFilteredRowsChangeRef.current = onFilteredRowsChange;
  const onParseCompleteRef = useRef(onParseComplete);
  onParseCompleteRef.current = onParseComplete;

  useEffect(() => {
    onFilteredRowsChangeRef.current?.(processedRows);
  }, [processedRows]);

  const handleExportExcel = useCallback(async () => {
    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const visibleColumns = columns.filter(
      (c) => !c.hidden && columnVisibility[String(c.accessor)] !== false,
    );
    // Server mode holds one page, so the export asks for the whole filtered
    // set rather than writing out whatever happens to be on screen.
    const rowsToExport: Record<string, unknown>[] = server
      ? await server.getAllFilteredRows(visibleColumns.map((c) => String(c.accessor)))
      : (processedRows as unknown as Record<string, unknown>[]);
    const exportData = rowsToExport.map((row) => {
      const obj: Record<string, string> = {};
      for (const col of visibleColumns) {
        const accessor = String(col.accessor);
        const label = col.header;
        let val = String(row[accessor] ?? "");
        if (
          accessor === "itemSchedules" ||
          accessor === "proposedErpItemName" ||
          accessor === "proposedErpQuantity" ||
          accessor === "cva"
        ) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              val = parsed.map(String).join(" | ");
            }
          } catch {
            // not JSON, keep raw string
          }
        }
        if (accessor === "assignedTo") {
          const ids = (val || "").split(",").filter(Boolean);
          val = ids
            .map((id) => {
              const a = associations.find((assoc) => assoc.id === parseInt(id));
              return a ? `${a.name}(${a.email})` : "";
            })
            .filter(Boolean)
            .join("\n");
        }
        if (accessor === "app" || accessor === "aps" || accessor === "apm") {
          val = val !== "YES" && val !== "NO" ? "" : val;
        }
        obj[label] = val.length > 32767 ? val.slice(0, 32767) : val;
      }
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tenders");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `tenders-${date}.xlsx`);
  }, [columns, processedRows, associations, columnVisibility, server]);

  const handleDownloadPdfs = useCallback(async () => {
    if (gemTendersToDownload.length === 0) return;
    setIsDownloadingPdfs(true);
    try {
      const res = await fetch("/api/download-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenders: gemTendersToDownload }),
      });
      const data = await res.json();
      const msg =
        data.failed > 0
          ? `Downloaded ${data.success}/${data.total} PDFs (${data.failed} failed)`
          : `Downloaded ${data.success} PDFs successfully`;
      alert(msg);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloadingPdfs(false);
    }
  }, [gemTendersToDownload]);

  const handleParsePdfs = useCallback(async () => {
    if (tendersToParse.length === 0) return;
    setIsParsingPdfs(true);
    try {
      const res = await fetch("/api/parse-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenders: tendersToParse }),
      });
      const data = await res.json();
      const msg =
        data.failed > 0
          ? `Parsed ${data.success}/${data.total} PDFs (${data.failed} failed)`
          : `Parsed ${data.success} PDFs successfully`;
      alert(msg);
      onParseCompleteRef.current?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setIsParsingPdfs(false);
    }
  }, [tendersToParse]);

  const handleParseCva = useCallback(async () => {
    if (tendersForCvaParsing.length === 0) return;
    setIsParsingCva(true);
    try {
      const res = await fetch("/api/parse-cva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenders: tendersForCvaParsing }),
      });
      const data = await res.json();
      const msg =
        data.queued > 0
          ? `Queued ${data.queued} tenders for CVA parsing`
          : "No tenders queued";
      alert(msg);
      onParseCompleteRef.current?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Parse CVA failed");
    } finally {
      setIsParsingCva(false);
    }
  }, [tendersForCvaParsing]);

  const formatCurrency = useCallback(
    (val: number | null | undefined): string => {
      if (val === null || val === undefined) return "-";
      return new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 0,
      }).format(val);
    },
    [],
  );

  const formatDate = useCallback(
    (val: Date | string | number | null | undefined): string => {
      return formatDateISTLong(val);
    },
    [],
  );

  const formatPercentage = useCallback(
    (val: number | null | undefined): string => {
      if (val === null || val === undefined) return "-";
      const prefix = val > 0 ? "+" : "";
      return `${prefix}${(val * 100).toFixed(1)}%`;
    },
    [],
  );

  const updateColumnFilter = useCallback(
    (accessor: string, filterType: ColumnFilterType, value: unknown) => {
      startTransition(() => {
        dispatch(setColumnFilter({ accessor, filterType, value }));
        setCurrentPage(1);
      });
    },
    [dispatch],
  );

  const handleClearColumnFilter = useCallback(
    (accessor: string, filterType: ColumnFilterType) => {
      startTransition(() => {
        dispatch(clearColumnFilterAction({ accessor, filterType }));
        setCurrentPage(1);
      });
    },
    [dispatch],
  );

  const renderFilter = useCallback(
    (col: ColumnDef<T>) => {
      const accessorStr = String(col.accessor);
      const filterState = columnFilters[accessorStr];

      if (!col.filter) return null;

      if (accessorStr === "deadline") {
        return (
          <DeadlineColumnFilter
            preset={filterState?.select?.[0] ?? ""}
            onPresetChange={(v) => {
              if (v) {
                startTransition(() => {
                  dispatch(
                    clearColumnFilterAction({
                      accessor: accessorStr,
                      filterType: "dateRange",
                    }),
                  );
                  dispatch(
                    setColumnFilter({
                      accessor: accessorStr,
                      filterType: "select",
                      value: [v],
                    }),
                  );
                });
              } else {
                startTransition(() => {
                  dispatch(
                    clearColumnFilterAction({
                      accessor: accessorStr,
                      filterType: "select",
                    }),
                  );
                });
              }
              setCurrentPage(1);
            }}
            startDate={filterState?.dateRange?.startDate ?? ""}
            endDate={filterState?.dateRange?.endDate ?? ""}
            onStartDateChange={(v) => {
              startTransition(() => {
                dispatch(
                  clearColumnFilterAction({
                    accessor: accessorStr,
                    filterType: "select",
                  }),
                );
                dispatch(
                  setColumnFilter({
                    accessor: accessorStr,
                    filterType: "dateRange",
                    value: {
                      startDate: v,
                      endDate: filterState?.dateRange?.endDate ?? "",
                    },
                  }),
                );
              });
              setCurrentPage(1);
            }}
            onEndDateChange={(v) => {
              startTransition(() => {
                dispatch(
                  clearColumnFilterAction({
                    accessor: accessorStr,
                    filterType: "select",
                  }),
                );
                dispatch(
                  setColumnFilter({
                    accessor: accessorStr,
                    filterType: "dateRange",
                    value: {
                      startDate: filterState?.dateRange?.startDate ?? "",
                      endDate: v,
                    },
                  }),
                );
              });
              setCurrentPage(1);
            }}
            onClearDateRange={() => {
              startTransition(() => {
                dispatch(
                  clearColumnFilterAction({
                    accessor: accessorStr,
                    filterType: "dateRange",
                  }),
                );
              });
              setCurrentPage(1);
            }}
          />
        );
      }

      switch (col.filter.type) {
        case "dateRange":
          return (
            <DateRangeColumnFilter
              startDate={filterState?.dateRange?.startDate ?? ""}
              endDate={filterState?.dateRange?.endDate ?? ""}
              onStartDateChange={(v) =>
                updateColumnFilter(accessorStr, "dateRange", {
                  startDate: v,
                  endDate: filterState?.dateRange?.endDate ?? "",
                })
              }
              onEndDateChange={(v) =>
                updateColumnFilter(accessorStr, "dateRange", {
                  startDate: filterState?.dateRange?.startDate ?? "",
                  endDate: v,
                })
              }
              onClear={() => handleClearColumnFilter(accessorStr, "dateRange")}
            />
          );
        case "select": {
          const configuredOptions = col.filter.options ?? [];
          const facetOptions = server ? server.getFacetOptions(accessorStr) : null;
          const computedOptions = server
            ? (facetOptions ?? [])
            : (uniqueSelectOptions[accessorStr] ?? []);
          let filteredConfigured = configuredOptions;
          if (
            // Without loaded facet values there is nothing to prune against,
            // and pruning would wipe the hardcoded options instead.
            (!server || facetOptions !== null) &&
            !STATIC_SELECT_SKIP.has(accessorStr) &&
            !UNIQUE_OPTION_SKIP.has(accessorStr)
          ) {
            const allowed = new Set<string>();
            for (const opt of computedOptions) allowed.add(opt.value);
            const activeSelected = columnFilters[accessorStr]?.select ?? [];
            for (const v of activeSelected) allowed.add(v);
            allowed.add("__blank__");
            filteredConfigured = configuredOptions.filter((opt) =>
              allowed.has(opt.value),
            );
          }
          const mergedOptions: FilterOption[] = [];
          const seenOptions = new Set<string>();
          for (const opt of [...filteredConfigured, ...computedOptions]) {
            if (seenOptions.has(opt.value)) continue;
            seenOptions.add(opt.value);
            mergedOptions.push(opt);
          }
          return (
            <SelectColumnFilter
              onOpen={
                // requestFacet decides whether this column is worth a query.
                server ? () => server.requestFacet(accessorStr) : undefined
              }
              value={filterState?.select ?? EMPTY_SELECT_VALUES}
              onChange={(values) => {
                if (col.filter?.searchable) {
                  startTransition(() => {
                    dispatch(
                      clearColumnFilterAction({
                        accessor: accessorStr,
                        filterType: "text",
                      }),
                    );
                  });
                }
                updateColumnFilter(accessorStr, "select", values);
              }}
              options={mergedOptions}
              placeholder={col.filter.placeholder}
              searchable={col.filter.searchable}
              triggerClassName="!w-full !justify-between !bg-card !text-foreground !border-input"
              onSearchChange={
                col.filter?.searchable
                  ? (text) => {
                      startTransition(() => {
                        dispatch(
                          clearColumnFilterAction({
                            accessor: accessorStr,
                            filterType: "select",
                          }),
                        );
                        if (text) {
                          dispatch(
                            setColumnFilter({
                              accessor: accessorStr,
                              filterType: "text",
                              value: text,
                            }),
                          );
                        } else {
                          dispatch(
                            clearColumnFilterAction({
                              accessor: accessorStr,
                              filterType: "text",
                            }),
                          );
                        }
                      });
                      setCurrentPage(1);
                    }
                  : undefined
              }
            />
          );
        }
        case "text":
          return (
            <TextColumnFilter
              value={filterState?.text ?? ""}
              onChange={(v) => updateColumnFilter(accessorStr, "text", v)}
              placeholder={col.filter.placeholder}
            />
          );
        case "boolean":
          return (
            <BooleanColumnFilter
              value={filterState?.boolean ?? null}
              onChange={(v) => updateColumnFilter(accessorStr, "boolean", v)}
            />
          );
        case "rawMaterials":
          return (
            <RawMaterialsColumnFilter
              value={filterState?.rawMaterials}
              onChange={(v) => updateColumnFilter(accessorStr, "rawMaterials", v)}
            />
          );
        default:
          return null;
      }
    },
    [columnFilters, updateColumnFilter, handleClearColumnFilter, uniqueSelectOptions],
  );

  const renderCell = useCallback(
    (col: ColumnDef<T>, row: T): React.ReactNode => {
      const value = row[col.accessor as keyof T];

      if (col.renderCell) {
        return col.renderCell(value, row);
      }

      if (String(col.accessor).toLowerCase() === "quantity") {
        const totalQty = row.totalQuantity as string | null | undefined;
        const qty = value as string | null | undefined;

        if (
          totalQty &&
          totalQty !== "0" &&
          totalQty !== "" &&
          (!qty || qty === "")
        ) {
          return totalQty;
        }
      }

      const parseJsonOrSplit = (raw: unknown, splitBy: RegExp | string, useKeys = false): string[] => {
        if (raw == null) return [];
        if (typeof raw === "object" && !(raw instanceof Date)) {
          if (Array.isArray(raw)) return (raw as any[]).map(String);
          return (useKeys ? Object.keys(raw as Record<string, unknown>) : Object.values(raw as Record<string, unknown>)).map(String);
        }
        if (typeof raw !== "string") return [];
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map(String);
          if (typeof parsed === "object" && parsed !== null) return (useKeys ? Object.keys(parsed) : Object.values(parsed)).map(String);
        } catch {
          // not JSON, fallback to split
        }
        return raw.split(splitBy).map(p => p.trim()).filter(Boolean);
      };

      const renderStacked = (parts: string[], alignCenter = false) => {
        if (parts.length === 0) return "-";
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", ...(alignCenter ? { alignItems: "center" } : {}) }}>
            {parts.map((part, i) => <div key={i} style={{ background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>{part}</div>)}
          </div>
        );
      };

      const accStr = String(col.accessor);
      if (accStr === "itemSchedules") {
        return renderStacked(parseJsonOrSplit(value, /\n+/));
      }
      if (accStr === "proposedErpItemName") {
        return renderStacked(parseJsonOrSplit(value, /\n+/, true));
      }
      if (accStr === "proposedErpQuantity") {
        return renderStacked(parseJsonOrSplit(value, /[\n,;]+/));
      }
      if (accStr === "cva") {
        return renderStacked(parseJsonOrSplit(value, /@/), true);
      }

      if (accStr === "rawMaterials") {
        let entries: [string, unknown][] = [];
        if (value != null && value !== "") {
          if (typeof value === "object") {
            entries = Object.entries(value);
          } else {
            try {
              const parsed = JSON.parse(String(value));
              if (typeof parsed === "object" && parsed !== null) {
                entries = Object.entries(parsed);
              }
            } catch {}
          }
        }
        const nonNull = entries.filter(
          ([, v]) => v !== null && v !== undefined && String(v) !== "",
        );
        if (nonNull.length === 0) return "-";
        return (
          <div
            className="raw-materials-grid"
            title={nonNull.map(([k, v]) => `${k}: ${String(v)}`).join(" | ")}
          >
            {nonNull.map(([key, val], i) => (
              <div
                className="material-rate-tag"
                key={i}
                title={`${key}: ${String(val)}`}
              >
                <span className="mat-lbl">{key}:</span>
                <span className="mat-val">{String(val)}</span>
              </div>
            ))}
          </div>
        );
      }

      if (col.type === "currency") {
        return formatCurrency(value as number | null | undefined);
      }

      if (col.type === "percentage") {
        return formatPercentage(value as number | null | undefined);
      }

      if (col.type === "date") {
        return formatDate(value as Date | string | number | null | undefined);
      }

      if (col.type === "boolean") {
        const isTrue = Boolean(value);
        return (
          <span
            className={`ra-icon ${isTrue ? "applicable" : "not-applicable"}`}
          >
            {isTrue ? <Check size={14} /> : <Circle size={14} />}
          </span>
        );
      }

      if (col.type === "status") {
        const statusVal = String(value ?? "").toUpperCase();
        const statusClass =
          statusVal === "WON"
            ? "won"
            : statusVal === "LOST" || statusVal === "DISQUALIFIED"
              ? "lost"
              : statusVal === "UNDER_EVALUATION" || statusVal === "EVAL"
                ? "eval"
                : statusVal === "SUBMITTED"
                  ? "submitted"
                  : statusVal === "RA_PENDING" || statusVal === "LOI"
                    ? "loi"
                    : "";
        return (
          <span className={`status-badge ${statusClass}`}>
            {value != null ? String(value) : "-"}
          </span>
        );
      }

      if (col.type === "decision") {
        const decVal = String(value ?? "").toUpperCase();
        const decClass =
          decVal === "GO"
            ? "go"
            : decVal === "NO_GO" || decVal === "NOGO"
              ? "nogo"
              : "";
        return (
          <span className={`decision-badge ${decClass}`}>
            {value != null ? String(value) : "-"}
          </span>
        );
      }

      return value !== null && value !== undefined ? String(value) : "-";
    },
    [formatCurrency, formatPercentage, formatDate],
  );

  const getColumnAlignClass = useCallback((col: ColumnDef<T>): string => {
    if (col.align === "right") return "col-currency";
    if (col.align === "center") return "col-center";
    if (col.type === "currency") return "col-currency";
    if (col.type === "percentage") return "col-percentage";
    if (
      col.type === "boolean" ||
      col.type === "status" ||
      col.type === "decision"
    )
      return "col-center";
    return "";
  }, []);

  return (
    <div className="optimized-tender-table-container">
      <div className="optimized-tender-table-toolbar">
        <div className="toolbar-left">
          <h2 className="table-title">{title}</h2>
          <span className="record-count-badge">
            {totalRecords} Records Total
          </span>
          {!server && (
            <div className="global-search-container">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                className="global-search-input"
                placeholder="Search..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="toolbar-right">
          {showExport && (
            <button className="export-btn" onClick={handleExportExcel}>
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          )}
          {/* <button
            className="export-btn"
            onClick={handleParseCva}
            disabled={isParsingCva || tendersForCvaParsing.length === 0}
          >
            {isParsingCva
              ? <><Loader2 size={14} className="animate-spin" /> Parsing CVA...</>
              : <><FileText size={14} /> Parse CVA ({tendersForCvaParsing.length})</>}
          </button> */}
          {/* <button
            className="export-btn"
            onClick={handleDownloadPdfs}
            disabled={isDownloadingPdfs || gemTendersToDownload.length === 0}
          >
            {isDownloadingPdfs
              ? <><Loader2 size={14} className="animate-spin" /> Downloading...</>
              : <><FileDown size={14} /> Download PDFs ({gemTendersToDownload.length})</>}
          </button>
          <button
            className="export-btn"
            onClick={handleParsePdfs}
            disabled={isParsingPdfs || tendersToParse.length === 0}
          >
            {isParsingPdfs
              ? <><Loader2 size={14} className="animate-spin" /> Parsing...</>
              : <><FileText size={14} /> Parse PDFs ({tendersToParse.length})</>}
          </button> */}
          <div className="column-picker-container">
            <MultiSelect
              title="Toggle Columns"
              placeholder="Columns"
              showCount={false}
              includeBlank={false}
              searchable
              searchPlaceholder="Search columns..."
              emptyText="No columns found"
              align="end"
              triggerIcon={<Columns3 size={14} />}
              options={columnPickerOptions}
              value={visibleColumnAccessors}
              onChange={handleColumnVisibilityChange}
            />
          </div>
          <button
            className="reset-filters-btn"
            onClick={() => {
              setGlobalSearch("");
              dispatch(resetColumnFilters());
              setCurrentPage(1);
            }}
          >
            <RotateCcw size={14} /> Reset Filters
          </button>
          {extraToolbarActions}
        </div>
      </div>

      <div className="optimized-tender-table-wrapper" ref={scrollContainerRef}>
        <table className="optimized-tender-data-table">
          <thead className="w-full">
            <tr>
              {visibleColumns.map((col, colIdx) => {
                const isFrozen = col.frozen;
                const offset = isFrozen
                  ? frozenColumnOffsets[String(col.accessor)]
                  : undefined;
                return (
                  <th
                    key={String(col.accessor)}
                    className={isFrozen ? "sticky-column" : ""}
                    style={{
                      width: `${columnWidths[String(col.accessor)]}px`,
                      ...(isFrozen ? { left: `${offset}px`, zIndex: 3 } : {}),
                    }}
                  >
                    <div
                      className="header-content"
                      onClick={() =>
                        col.sortable !== false &&
                        handleSort(String(col.accessor))
                      }
                    >
                      <span>{col.header}</span>
                      {sortColumn === String(col.accessor) && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                    {col.provenance && col.provenance.length > 0 && (
                      <div
                        className="flex gap-1 mt-1 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {col.provenance.map((badge) => {
                          const badgeClass =
                            badge === "PRE"
                              ? "bg-brand-light text-signal border-signal/40 hover:bg-brand-light"
                              : badge === "POST"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                : "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100";
                          return (
                            <Badge
                              key={badge}
                              className={`inline-flex w-fit text-[9px] font-medium px-1.5 py-0 border ${badgeClass}`}
                            >
                              {badge}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    {(() => {
                      try {
                        return renderFilter(col);
                      } catch (e) {
                        console.error("renderFilter error for", col.header, e);
                        return null;
                      }
                    })()}
                    {col.searchable !== false && (
                      <DebouncedColumnSearch
                        placeholder={`Search ${col.header}...`}
                        value={columnFilters[String(col.accessor)]?.text ?? ""}
                        onSearch={(text) => {
                          dispatch(
                            setColumnFilter({
                              accessor: String(col.accessor),
                              filterType: "text",
                              value: text,
                            }),
                          );
                          setCurrentPage(1);
                        }}
                        onClear={() => {
                          dispatch(
                            clearColumnFilterAction({
                              accessor: String(col.accessor),
                              filterType: "text",
                            }),
                          );
                          setCurrentPage(1);
                        }}
                      />
                    )}
                    {col.resizable !== false && (
                      <div
                        className="column-resizer"
                        onMouseDown={(e) =>
                          handleResizeStart(
                            e,
                            String(col.accessor),
                            columnWidths[String(col.accessor)],
                          )
                        }
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "rgba(0,0,0,0.4)",
                  }}
                >
                  No matching records found.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const rowKeyValue = getRowKey(row);
                const isExpanded = !!expandedRows[rowKeyValue];

                return (
                  <React.Fragment key={rowKeyValue}>
                    <tr
                      className={`tender-row ${isExpanded ? "expanded-row" : ""}`}
                    >
                      {visibleColumns.map((col, colIdx) => {
                        const isFrozen = col.frozen;
                        const offset = isFrozen
                          ? frozenColumnOffsets[String(col.accessor)]
                          : undefined;
                        const cellClass = getColumnAlignClass(col);
                        let cellContent;
                        try {
                          cellContent = renderCell(col, row);
                        } catch (e) {
                          console.error("renderCell error for", col.header, e);
                          cellContent = "ERR";
                        }

                        return (
                          <td
                            key={String(col.accessor)}
                            className={`${cellClass}${isFrozen ? " sticky-column" : ""}`}
                            style={{
                              width: `${columnWidths[String(col.accessor)]}px`,
                              ...(isFrozen ? { left: `${offset}px` } : {}),
                              ...(col.accessor === "remarks"
                                ? { height: "100%" }
                                : {}),
                            }}
                            onClick={() => onRowClick?.(row)}
                          >
                            <div
                              style={{
                                height:
                                  col.accessor === "remarks"
                                    ? "100%"
                                    : undefined,
                                maxHeight: 160,
                                overflowY: "auto",
                                whiteSpace: "normal",
                              }}
                            >
                              {cellContent}
                            </div>
                          </td>
                        );
                      })}
                    </tr>

                    {isExpanded && columns.some((c) => c.renderExpanded) && (
                      <tr className="details-panel-row">
                        <td colSpan={columns.length}>
                          <div className="details-panel-content">
                            <div className="details-grid">
                              {columns
                                .filter((c) => c.renderExpanded)
                                .map((col) => (
                                  <div
                                    key={String(col.accessor)}
                                    className="details-item span-full"
                                  >
                                    <span className="details-label">
                                      {col.header}
                                    </span>
                                    <span className="details-value">
                                      {col.renderExpanded
                                        ? col.renderExpanded(row)
                                        : "-"}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="optimized-tender-table-footer">
        <div className="footer-left">
          <span>Rows per page:</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => {
              setRowsPerPage(Number(v));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger size="sm" className="rows-per-page-select h-7 w-auto text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100, 500].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="footer-center">
          Showing {totalRecords > 0 ? (activePage - 1) * rowsPerPage + 1 : 0} -{" "}
          {Math.min(activePage * rowsPerPage, totalRecords)} of {totalRecords}
        </div>

        <div className="footer-right">
          <button
            className="page-btn"
            onClick={() => setCurrentPage(1)}
            disabled={activePage === 1}
          >
            FIRST
          </button>
          <button
            className="page-btn"
            onClick={() => setCurrentPage(Math.max(1, activePage - 1))}
            disabled={activePage === 1}
          >
            PREV
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
            let pageNum = idx + 1;
            if (totalPages > 5 && activePage > 3) {
              pageNum = activePage - 3 + idx;
              if (pageNum + (4 - idx) > totalPages) {
                pageNum = totalPages - 4 + idx;
              }
            }
            return (
              <button
                key={pageNum}
                className={`page-btn ${activePage === pageNum ? "active" : ""}`}
                onClick={() => setCurrentPage(pageNum)}
              >
                {pageNum}
              </button>
            );
          })}

          {totalPages > 5 && activePage < totalPages - 2 && (
            <>
              <span style={{ padding: "0 4px", color: "rgba(0,0,0,0.4)" }}>
                ...
              </span>
              <button
                className={`page-btn ${activePage === totalPages ? "active" : ""}`}
                onClick={() => setCurrentPage(totalPages)}
              >
                {totalPages}
              </button>
            </>
          )}

          <button
            className="page-btn"
            onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}
            disabled={activePage === totalPages}
          >
            NEXT
          </button>
          <button
            className="page-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={activePage === totalPages}
          >
            LAST
          </button>
        </div>
      </div>
    </div>
  );
}

export const OptimizedTenderTable = React.memo(
  OptimizedTenderTableInner,
) as typeof OptimizedTenderTableInner;
