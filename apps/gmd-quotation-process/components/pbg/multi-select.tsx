"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "@/components/pbg/icons";

type MultiSelectProps = {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  maxHeight?: number;
};

export function MultiSelect({
  options,
  selected,
  onChange,
  searchable = true,
  maxHeight = 220,
}: MultiSelectProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = new Set(selected);

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(Array.from(next));
  }

  function selectAllVisible() {
    const next = new Set(selectedSet);
    for (const option of filtered) next.add(option);
    onChange(Array.from(next));
  }

  if (options.length === 0) {
    return <p className="px-1 py-2 text-xs text-slate-400">No values</p>;
  }

  return (
    <div>
      {searchable && options.length > 8 && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search values…"
            className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      )}

      <div
        className="overflow-y-auto rounded-md border border-slate-200"
        style={{ maxHeight }}
      >
        {filtered.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(option)}
              onChange={() => toggle(option)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            <span className="break-words">{option}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-slate-400">No matches</p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={selectAllVisible}
          className="font-medium text-indigo-600 hover:text-indigo-700"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="font-medium text-slate-500 hover:text-slate-700"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
