"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DEFAULT_VISIBLE_COLUMNS,
  PBG_COLUMN_DEFS,
  type ColumnKey,
} from "@/lib/pbg/pbg-columns";
import {
  describeFilter,
  filterRecords,
  getDistinctValues,
  isFilterActive,
  type ColumnFilter,
  type FilterState,
} from "@/lib/pbg/pbg-filter";
import {
  getStatusOptions,
  toRecordValue,
  valueToRaw,
  type RecordValue,
} from "@/lib/pbg/pbg-cell";
import {
  describeSelection,
  isEmptySelection,
  matchesAnySelection,
  toggleSelection,
  type PbgTreeSelection,
} from "@/lib/pbg/pbg-tree";
import type { PbgRecord } from "@/lib/pbg/pbg-data";
import { computeExtendedValidity } from "@/lib/pbg/validity";
import {
  removePbgBankGuaranteeFileAction,
  updatePbgCellAction,
  uploadPbgBankGuaranteeAction,
} from "@/app/pbg/actions";
import { PbgGrid } from "@/components/pbg/pbg-grid";
import { PbgTree } from "@/components/pbg/pbg-tree";
import { SyncButton } from "@/components/pbg/sync-button";
import { ColumnVisibility } from "@/components/pbg/column-visibility";
import { Popover } from "@/components/pbg/popover";
import { ColumnsIcon, SearchIcon, XIcon } from "@/components/pbg/icons";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

function PanelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function UndoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}

function RedoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h1" />
    </svg>
  );
}

const SELECTION_ORDER: Array<keyof PbgTreeSelection> = [
  "clientName",
  "project",
  "bgNo",
  "poNumber",
];

const SELECTION_DEPTH: Partial<Record<ColumnKey, number>> = {
  clientName: 0,
  project: 1,
  bgNo: 2,
  poNumber: 3,
};

/** Drops `key` and any deeper level from a tree selection. */
function stripSelection(
  key: ColumnKey,
  selection: PbgTreeSelection,
): PbgTreeSelection {
  const depth = SELECTION_DEPTH[key];
  if (depth === undefined) return selection;
  const next: PbgTreeSelection = {};
  for (const level of SELECTION_ORDER.slice(0, depth)) {
    const value = selection[level];
    if (value !== undefined) next[level] = value;
  }
  return next;
}

/** One cell edit, enough to reverse it (undo) or reapply it (redo). */
type CellChange = {
  id: string;
  key: ColumnKey;
  from: RecordValue;
  to: RecordValue;
};

export function PbgTable({
  records,
  includeClosed,
}: {
  records: PbgRecord[];
  includeClosed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [rows, setRows] = useState(records);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [selections, setSelections] = useState<PbgTreeSelection[]>([]);
  const [visible, setVisible] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [undoStack, setUndoStack] = useState<CellChange[]>([]);
  const [redoStack, setRedoStack] = useState<CellChange[]>([]);

  const activeColumns = useMemo(
    () => PBG_COLUMN_DEFS.filter((def) => visible.includes(def.key)),
    [visible],
  );

  // Cascading (faceted) value lists: each column's options are computed from
  // the rows that pass every OTHER active filter (+ the search query), so the
  // choices narrow as filters are applied. A column's own filter is excluded so
  // its selection can still be changed.
  const distinctMap = useMemo(() => {
    const map = new Map<ColumnKey, string[]>();
    for (const def of PBG_COLUMN_DEFS) {
      if (def.type === "files") continue;
      const scopeFilters = { ...filters };
      delete scopeFilters[def.key];
      const scope = filterRecords(rows, scopeFilters, query);
      map.set(def.key, getDistinctValues(scope, def.key));
    }
    return map;
  }, [rows, filters, query]);

  const statusOptions = useMemo(() => getStatusOptions(rows), [rows]);

  const filtered = useMemo(() => {
    const base = filterRecords(rows, filters, query);
    return selections.length === 0
      ? base
      : base.filter((row) => matchesAnySelection(row, selections));
  }, [rows, filters, query, selections]);

  const activeFilterDefs = useMemo(
    () => PBG_COLUMN_DEFS.filter((def) => isFilterActive(filters[def.key])),
    [filters],
  );

  const hasAnyFilter =
    activeFilterDefs.length > 0 || query.trim() !== "" || selections.length > 0;

  function setColumnFilter(key: ColumnKey, value: ColumnFilter | undefined) {
    setFilters((prev) => {
      const next = { ...prev };
      if (!value || !isFilterActive(value)) delete next[key];
      else next[key] = value;
      return next;
    });
    if (SELECTION_DEPTH[key] !== undefined) {
      setSelections((prev) =>
        prev
          .map((entry) => stripSelection(key, entry))
          .filter((entry) => !isEmptySelection(entry)),
      );
    }
  }

  function clearAll() {
    setQuery("");
    setFilters({});
    setSelections([]);
  }

  function handleToggleClosed() {
    const query = includeClosed ? "" : "?includeClosed=1";
    startTransition(() => {
      router.replace(`${pathname}${query}`, { scroll: false });
    });
  }

  const applyChange = useCallback(
    async (
      id: string,
      key: ColumnKey,
      from: RecordValue,
      to: RecordValue,
      record: boolean,
    ): Promise<boolean> => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const nextRow = {
            ...row,
            [key]: to,
            updatedAt: new Date().toISOString(),
          } as PbgRecord;
          if (key === "validityOn") {
            nextRow.extendedValidity = computeExtendedValidity(
              to === null || to === undefined ? null : String(to),
              row.lastSupplyDate,
            );
          }
          return nextRow;
        }),
      );
      setSaving((prev) => new Set(prev).add(`${id}:${key}`));
      setError(null);

      const result = await updatePbgCellAction(id, key, valueToRaw(to));

      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(`${id}:${key}`);
        return next;
      });

      if (!result.ok) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === id ? ({ ...row, [key]: from } as PbgRecord) : row,
          ),
        );
        setError(result.error);
        return false;
      }

      if (record) {
        setUndoStack((prev) => [...prev, { id, key, from, to }]);
        setRedoStack([]);
      }
      return true;
    },
    [],
  );

  const handleUploadBankGuarantee = useCallback(
    async (id: string, files: File[]): Promise<void> => {
      setError(null);
      const result = await uploadPbgBankGuaranteeAction(id, files);
      if (result.ok) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === id ? { ...row, bankGuarantee: result.files } : row,
          ),
        );
      } else {
        setError(result.error);
      }
    },
    [],
  );

  const handleRemoveBankGuarantee = useCallback(
    async (id: string, url: string): Promise<void> => {
      setError(null);
      const result = await removePbgBankGuaranteeFileAction(id, url);
      if (result.ok) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === id ? { ...row, bankGuarantee: result.files } : row,
          ),
        );
      } else {
        setError(result.error);
      }
    },
    [],
  );

  const handleCommit = useCallback(
    (id: string, key: ColumnKey, raw: string) => {
      const current = rows.find((row) => row.id === id);
      const from = current ? (current[key] as RecordValue) : null;
      const to = toRecordValue(key, raw);
      if (from === to) return;
      void applyChange(id, key, from, to, true);
    },
    [rows, applyChange],
  );

  const undo = useCallback(async () => {
    const change = undoStack[undoStack.length - 1];
    if (!change) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, change]);
    const ok = await applyChange(change.id, change.key, change.to, change.from, false);
    if (!ok) {
      setUndoStack((prev) => [...prev, change]);
      setRedoStack((prev) => prev.filter((entry) => entry !== change));
    }
  }, [undoStack, applyChange]);

  const redo = useCallback(async () => {
    const change = redoStack[redoStack.length - 1];
    if (!change) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, change]);
    const ok = await applyChange(change.id, change.key, change.from, change.to, false);
    if (!ok) {
      setRedoStack((prev) => [...prev, change]);
      setUndoStack((prev) => prev.filter((entry) => entry !== change));
    }
  }, [redoStack, applyChange]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        active?.isContentEditable
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        void redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const grid = (
    <div className="flex h-full min-h-0 flex-col">
      <PbgGrid
        rows={filtered}
        columns={activeColumns}
        filters={filters}
        onSetFilter={setColumnFilter}
        distinctMap={distinctMap}
        statusOptions={statusOptions}
        saving={saving}
        onCommit={handleCommit}
        onUploadBankGuarantee={handleUploadBankGuarantee}
        onRemoveBankGuarantee={handleRemoveBankGuarantee}
      />
    </div>
  );

  return (
    <section className="relative flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-slate-900">PBG Records</h2>
          <span className="text-sm text-slate-500">
            {filtered.length.toLocaleString("en-IN")} of{" "}
            {rows.length.toLocaleString("en-IN")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTreeOpen((value) => !value)}
            title={treeOpen ? "Hide navigator" : "Show navigator"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <PanelIcon />
            {treeOpen ? "Hide tree" : "Show tree"}
          </button>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search records…"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:w-64"
            />
          </div>

          <Popover
            ariaLabel="Choose columns"
            trigger={
              <span className="inline-flex items-center gap-1.5">
                <ColumnsIcon />
                Columns
              </span>
            }
            triggerClassName="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {() => <ColumnVisibility visible={visible} onChange={setVisible} />}
          </Popover>

          <button
            type="button"
            onClick={() => void undo()}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UndoIcon />
            Undo
          </button>

          <button
            type="button"
            onClick={() => void redo()}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl+Y)"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RedoIcon />
            Redo
          </button>

          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <XIcon />
              Clear all
            </button>
          )}

          <SyncButton />
        </div>
      </div>

      {(activeFilterDefs.length > 0 || selections.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
          {selections.map((entry, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
            >
              <span className="text-emerald-500">Navigator:</span>
              <span className="max-w-[16rem] truncate">{describeSelection(entry)}</span>
              <button
                type="button"
                onClick={() =>
                  setSelections((prev) => prev.filter((_, i) => i !== index))
                }
                aria-label="Remove navigator selection"
                className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {activeFilterDefs.map((def) => (
            <span
              key={def.key}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
            >
              <span className="text-indigo-400">{def.label}:</span>
              {describeFilter(filters[def.key] as ColumnFilter)}
              <button
                type="button"
                onClick={() => setColumnFilter(def.key, undefined)}
                aria-label={`Remove ${def.label} filter`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          <span>Update failed: {error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded p-0.5 hover:bg-rose-100"
            aria-label="Dismiss error"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {treeOpen ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="pbg-tree" defaultSize="26" minSize="18" maxSize="50">
            <PbgTree
              records={rows}
              selections={selections}
              onToggleSelection={(entry) =>
                setSelections((prev) => toggleSelection(prev, entry))
              }
              includeClosed={includeClosed}
              onToggleClosed={handleToggleClosed}
              pending={pending}
              onClear={() => setSelections([])}
            />
          </ResizablePanel>

          <ResizableHandle withHandle className="mx-0.5 bg-border" />

          <ResizablePanel id="pbg-grid" defaultSize="74" minSize="30">
            {grid}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{grid}</div>
      )}
    </section>
  );
}
