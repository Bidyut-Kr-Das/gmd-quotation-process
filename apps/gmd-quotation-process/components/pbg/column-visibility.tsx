"use client";

import {
  DEFAULT_VISIBLE_COLUMNS,
  PBG_COLUMN_DEFS,
  type ColumnKey,
} from "@/lib/pbg/pbg-columns";

type ColumnVisibilityProps = {
  visible: ColumnKey[];
  onChange: (keys: ColumnKey[]) => void;
};

export function ColumnVisibility({ visible, onChange }: ColumnVisibilityProps) {
  const visibleSet = new Set(visible);

  function toggle(key: ColumnKey) {
    const next = new Set(visibleSet);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(PBG_COLUMN_DEFS.map((d) => d.key).filter((k) => next.has(k)));
  }

  return (
    <div className="w-60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">Columns</span>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_VISIBLE_COLUMNS)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          Reset
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {PBG_COLUMN_DEFS.map((column) => (
          <label
            key={column.key}
            className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={visibleSet.has(column.key)}
              onChange={() => toggle(column.key)}
              className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            {column.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        At least one column stays visible.
      </p>
    </div>
  );
}
