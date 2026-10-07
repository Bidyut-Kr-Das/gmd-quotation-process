"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export const BLANK = "__blank__";
export const AVAILABLE = "__available__";

interface MultiSelectFilterProps {
  label: string;
  allLabel: string;
  options: string[];
  cascadedOptions: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  counts?: Record<string, number>;
  includeBlank?: boolean;
  includeAvailable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  panelClassName?: string;
  align?: "start" | "center" | "end";
  renderButtonLabel?: (selected: string[], allLabel: string) => string;
}

export default function MultiSelectFilter({
  label,
  allLabel,
  options,
  cascadedOptions,
  selected,
  onChange,
  counts,
  includeBlank = false,
  includeAvailable = false,
  searchPlaceholder,
  className,
  panelClassName,
  align = "start",
  renderButtonLabel,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visibleOptions = useMemo(() => {
    const cascadedSet = new Set(cascadedOptions);
    const selectedSet = new Set(selected);
    const q = search.toLowerCase();
    return options.filter(
      (opt) => (cascadedSet.has(opt) || selectedSet.has(opt)) && opt.toLowerCase().includes(q)
    );
  }, [options, cascadedOptions, selected, search]);

  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt]
    );
  };

  const buttonLabel = renderButtonLabel
    ? renderButtonLabel(selected, allLabel)
    : selected.length === 0
    ? allLabel
    : `${selected.length} Selected`;

  const blankChecked = selected.includes(BLANK);
  const availableChecked = selected.includes(AVAILABLE);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger
        type="button"
        className={cn(
          "w-full h-7 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-left cursor-pointer flex items-center justify-between hover:bg-accent outline-none normal-case",
          className
        )}
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 ml-1" />
      </PopoverTrigger>

      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={4}
        className={cn(
          "w-64 rounded border border-border bg-popover text-popover-foreground shadow-lg p-2 flex flex-col gap-2 max-h-72",
          panelClassName
        )}
      >
        <div className="flex items-center gap-1.5 border border-border rounded px-2 py-1 bg-muted">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-[10px] bg-transparent outline-none border-none placeholder:text-muted-foreground p-0 h-4 normal-case"
          />
        </div>

        <div className="flex justify-between items-center px-1 text-[9px]">
          <button
            type="button"
            onClick={() => onChange(options)}
            className="text-blue-600 font-bold hover:underline cursor-pointer"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-muted-foreground font-bold hover:underline cursor-pointer"
          >
            Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border max-h-48 pr-0.5">
          {includeBlank && (
            <label className="flex items-center gap-2 py-1 px-1 hover:bg-accent cursor-pointer select-none text-[10px] text-foreground font-medium truncate">
              <input
                type="checkbox"
                checked={blankChecked}
                onChange={() => toggle(BLANK)}
                className="h-3 w-3 rounded text-blue-600 focus:ring-blue-500 border-border cursor-pointer"
              />
              <span className="truncate flex-1">(Blank)</span>
            </label>
          )}
          {includeAvailable && (
            <label className="flex items-center gap-2 py-1 px-1 hover:bg-accent cursor-pointer select-none text-[10px] text-foreground font-medium truncate">
              <input
                type="checkbox"
                checked={availableChecked}
                onChange={() => toggle(AVAILABLE)}
                className="h-3 w-3 rounded text-blue-600 focus:ring-blue-500 border-border cursor-pointer"
              />
              <span className="truncate flex-1">(Available)</span>
            </label>
          )}
          {visibleOptions.map((opt) => {
            const isChecked = selected.includes(opt);
            const count = counts?.[opt];
            return (
              <label
                key={opt}
                className="flex items-center gap-2 py-1 px-1 hover:bg-accent cursor-pointer select-none text-[10px] text-foreground font-medium truncate"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(opt)}
                  className="h-3 w-3 rounded text-blue-600 focus:ring-blue-500 border-border cursor-pointer"
                />
                <span className="truncate flex-1">{opt}</span>
                {count !== undefined && (
                  <span className="text-[9px] text-muted-foreground font-semibold shrink-0 ml-1">
                    ({count})
                  </span>
                )}
              </label>
            );
          })}
          {visibleOptions.length === 0 && !includeBlank && !includeAvailable && (
            <div className="py-2 px-3 text-xs text-muted-foreground italic">
              No options found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
