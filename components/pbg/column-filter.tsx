"use client";

import type { ColumnDef } from "@/lib/pbg/pbg-columns";
import type { ColumnFilter } from "@/lib/pbg/pbg-filter";
import { MultiSelect } from "@/components/pbg/multi-select";

type ColumnFilterPopoverProps = {
  def: ColumnDef;
  filter?: ColumnFilter;
  distinct: string[];
  onChange: (filter: ColumnFilter | undefined) => void;
};

const inputClass =
  "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";

export function ColumnFilterPopover({
  def,
  filter = {},
  distinct,
  onChange,
}: ColumnFilterPopoverProps) {
  function patch(next: Partial<ColumnFilter>) {
    const merged: ColumnFilter = { ...filter, ...next };
    const empty =
      !merged.text &&
      !(merged.selected && merged.selected.length > 0) &&
      !merged.from &&
      !merged.to &&
      typeof merged.min !== "number" &&
      typeof merged.max !== "number";
    onChange(empty ? undefined : merged);
  }

  const showMultiSelect = def.type !== "files";

  return (
    <div className="w-72 space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{def.label}</span>
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs font-medium text-slate-400 hover:text-slate-700"
        >
          Clear
        </button>
      </div>

      {def.type === "text" && (
        <input
          type="text"
          value={filter.text ?? ""}
          onChange={(event) => patch({ text: event.target.value })}
          placeholder="Contains…"
          className={inputClass}
        />
      )}

      {def.type === "date" && (
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">From</span>
            <input
              type="date"
              value={filter.from ?? ""}
              onChange={(event) => patch({ from: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">To</span>
            <input
              type="date"
              value={filter.to ?? ""}
              onChange={(event) => patch({ to: event.target.value })}
              className={inputClass}
            />
          </label>
        </div>
      )}

      {def.type === "number" && (
        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="mb-1 block text-[11px] text-slate-500">Min</span>
            <input
              type="number"
              value={typeof filter.min === "number" ? filter.min : ""}
              onChange={(event) =>
                patch({
                  min:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
              className={inputClass}
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-[11px] text-slate-500">Max</span>
            <input
              type="number"
              value={typeof filter.max === "number" ? filter.max : ""}
              onChange={(event) =>
                patch({
                  max:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
              className={inputClass}
            />
          </label>
        </div>
      )}

      {showMultiSelect && (
        <div>
          <span className="mb-1 block text-[11px] font-medium text-slate-500">
            Values
          </span>
          <MultiSelect
            options={distinct}
            selected={filter.selected ?? []}
            onChange={(values) => patch({ selected: values })}
          />
        </div>
      )}
    </div>
  );
}
