"use client";

import { useState } from "react";
import { Columns3, Search, X, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Table as TanStackTable } from "@tanstack/react-table";

interface ColumnPickerProps<TData> {
  table: TanStackTable<TData>;
  formatHeader?: (columnId: string) => string;
}

export function ColumnPicker<TData>({
  table,
  formatHeader = (id) => id,
}: ColumnPickerProps<TData>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <div className="relative">
      <Button
        size="xs"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="text-xs"
      >
        <Columns3 className="size-3" />
        Columns
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setSearch("");
            }}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-sm bg-white shadow-md ring-1 ring-slate-200 p-2 flex flex-col max-h-80">
            <p className="text-[11px] font-medium text-slate-500 px-1 py-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Toggle Columns</span>
              {(() => {
                const all = table.getAllLeafColumns().filter((c) => c.getCanHide());
                const visible = all.filter((c) => c.getIsVisible()).length;
                return (
                  <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">
                    {visible}/{all.length}
                  </span>
                );
              })()}
            </p>
            {/* Search */}
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search columns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-7 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-slate-400"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            {/* Select All / Clear */}
            <div className="flex items-center gap-1.5 mb-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="flex-1 h-7 text-[11px]"
                onClick={() => {
                  const cols = table
                    .getAllLeafColumns()
                    .filter((c) => c.getCanHide())
                    .filter((c) => {
                      if (!search.trim()) return true;
                      const label = formatHeader(c.id).toLowerCase();
                      const id = c.id.toLowerCase();
                      const q = search.toLowerCase();
                      return label.includes(q) || id.includes(q);
                    });
                  const next: Record<string, boolean> = { ...table.getState().columnVisibility };
                  cols.forEach((c) => {
                    next[c.id] = true;
                  });
                  table.setColumnVisibility(next);
                }}
              >
                <CheckCheck className="size-3" />
                Select All
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="flex-1 h-7 text-[11px]"
                onClick={() => {
                  const cols = table
                    .getAllLeafColumns()
                    .filter((c) => c.getCanHide())
                    .filter((c) => {
                      if (!search.trim()) return true;
                      const label = formatHeader(c.id).toLowerCase();
                      const id = c.id.toLowerCase();
                      const q = search.toLowerCase();
                      return label.includes(q) || id.includes(q);
                    });
                  const next: Record<string, boolean> = { ...table.getState().columnVisibility };
                  cols.forEach((c) => {
                    next[c.id] = false;
                  });
                  // guard: keep at least one visible
                  const remainingVisible = table
                    .getAllLeafColumns()
                    .filter((c) => c.getCanHide())
                    .filter((c) => next[c.id] !== false).length;
                  if (remainingVisible === 0 && cols.length > 0) {
                    // keep first filtered column visible
                    next[cols[0].id] = true;
                  }
                  table.setColumnVisibility(next);
                }}
              >
                <X className="size-3" />
                Clear
              </Button>
            </div>
            {/* Column list */}
            <div className="overflow-y-auto flex-1 -mr-1 pr-1">
              {(() => {
                const filtered = table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide())
                  .filter((c) => {
                    if (!search.trim()) return true;
                    const label = formatHeader(c.id).toLowerCase();
                    const id = c.id.toLowerCase();
                    const q = search.toLowerCase();
                    return label.includes(q) || id.includes(q);
                  });
                if (filtered.length === 0) {
                  return (
                    <p className="text-xs text-slate-400 text-center py-4">No columns found</p>
                  );
                }
                return filtered.map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-2 py-1.5 px-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                      className="size-3.5 accent-primary"
                    />
                    {formatHeader(column.id)}
                  </label>
                ));
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
