"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Sentinel used by the tables for rows with no value in this column. */
export const BLANK_VALUE = "(Blank)";

/**
 * Column filter for the data tables.
 *
 * This control existed five times over: a `<button>` plus a floating `<div>`
 * plus an outside-click `useRef`, re-implemented per table with slightly
 * different behaviour each time. Keyboard handling and focus management came
 * out differently every time too; the Popover primitive handles both.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  includeBlank = true,
  searchable = true,
  className,
  align = "start",
}: {
  /** Column name, used in the trigger text: "All Status". */
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  includeBlank?: boolean;
  searchable?: boolean;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const [query, setQuery] = React.useState("");

  const allOptions = React.useMemo(
    () => (includeBlank ? [...options, BLANK_VALUE] : options),
    [options, includeBlank],
  );

  const visible = React.useMemo(() => {
    if (!query.trim()) return allOptions;
    const q = query.toLowerCase();
    return allOptions.filter((o) => o.toLowerCase().includes(q));
  }, [allOptions, query]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const active = selected.length > 0;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-(--control-h-sm) w-full items-center justify-between gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
              active
                ? "border-brand-accent bg-brand-accent-surface text-brand-accent"
                : "border-input bg-background text-muted-foreground hover:bg-muted",
              className,
            )}
          />
        }
      >
        <span className="truncate">
          {active ? `${selected.length} selected` : `All ${label}`}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </PopoverTrigger>

      <PopoverContent align={align} className="w-60 p-0">
        {searchable ? (
          <div className="relative p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="h-(--control-h-sm) pl-7 text-xs"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-1 px-2 pb-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange(visible)}
            disabled={visible.length === 0}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange([])}
            disabled={!active}
          >
            Clear
          </Button>
        </div>

        <Separator />

        <div className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            visible.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Checkbox
                  checked={selected.includes(value)}
                  onCheckedChange={() => toggle(value)}
                />
                <span
                  className={cn(
                    "truncate",
                    value === BLANK_VALUE && "text-muted-foreground italic",
                  )}
                >
                  {value}
                </span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
