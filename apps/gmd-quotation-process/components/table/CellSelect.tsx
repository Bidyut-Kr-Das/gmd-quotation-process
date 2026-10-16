"use client";

/**
 * Inline single-select for table cells, styled to match the header filters
 * (`MultiSelectFilter`): same popover, same trigger, same search box.
 *
 * Why not a native `<select>`: the item-field markup was written twice over
 * (collapsed and expanded rows), and the long lookups — ~645 dockets for
 * `duplicateOfDocket` — are unusable as an OS scroll list. The search box is the
 * point, not only the styling.
 *
 * Variants:
 *   default — the header trigger, for a standalone cell.
 *   chip    — the trigger IS the small `moc:` style chip, so there is one border
 *             and no <label>-wrapping-a-control nesting.
 */

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@gmd/ui/components/popover";

const TRIGGER_BASE = "cursor-pointer outline-none disabled:opacity-50 disabled:cursor-not-allowed";

const TRIGGER_DEFAULT =
  "w-full h-7 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-left flex items-center justify-between hover:bg-accent normal-case";

const TRIGGER_CHIP =
  "flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 hover:bg-accent min-w-0";

export interface CellSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Trigger text when empty, and the label of the row that clears the value. */
  placeholder?: string;
  searchPlaceholder?: string;
  variant?: "default" | "chip";
  /** Chip variant only: the field name shown before the value (`moc:`). */
  chipLabel?: string;
  /** Merged into the trigger, so callers can add colour, size or width. */
  className?: string;
  panelClassName?: string;
  title?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  /** Keep a stored value selectable after it leaves the lookup list. */
  allowCustomValue?: boolean;
  /** Display text per option value (the value is still what is stored). */
  optionLabels?: Record<string, string>;
  /** Open on mount — for a cell whose dropdown replaces its display on click. */
  defaultOpen?: boolean;
  /** Fired whenever the panel closes, so the caller can drop the edit state. */
  onClose?: () => void;
}

/** Adds the stored value to the list when it is no longer a lookup option. */
export function optionsWithCurrent(options: string[], value: string | null | undefined): string[] {
  if (!value || options.includes(value)) return options;
  return [value, ...options];
}

export default function CellSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  variant = "default",
  chipLabel,
  className,
  panelClassName,
  title,
  disabled = false,
  align = "start",
  allowCustomValue = false,
  optionLabels,
  defaultOpen = false,
  onClose,
}: CellSelectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState("");

  const usableOptions = useMemo(
    () => (allowCustomValue ? optionsWithCurrent(options, value) : options),
    [options, value, allowCustomValue],
  );

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usableOptions;
    return usableOptions.filter(
      (opt) => opt.toLowerCase().includes(q) || (optionLabels?.[opt]?.toLowerCase().includes(q) ?? false),
    );
  }, [usableOptions, search, optionLabels]);

  const label = value || placeholder || "";
  // Show the option's display text when it has one, so a selected closed BOM
  // still reads "… (C - Closed BOM)" on the trigger.
  const triggerLabel = value ? optionLabels?.[value] ?? value : label;

  const pick = (next: string) => {
    setOpen(false);
    onClose?.();
    if (next !== value) onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) {
          setSearch("");
          onClose?.();
        }
      }}
    >
      <PopoverTrigger
        type="button"
        title={title}
        disabled={disabled}
        className={cn(TRIGGER_BASE, variant === "chip" ? TRIGGER_CHIP : TRIGGER_DEFAULT, className)}
      >
        {chipLabel && <span className="shrink-0">{chipLabel}:</span>}
        <span
          className={cn(
            "truncate",
            chipLabel && "flex-1 text-left text-xs text-foreground font-medium",
            !chipLabel && !value && placeholder === undefined && "text-muted-foreground",
          )}
          title={triggerLabel}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 ml-1" />
      </PopoverTrigger>

      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={4}
        className={cn(
          "w-64 rounded border border-border bg-popover text-popover-foreground shadow-lg p-2 flex flex-col gap-2 max-h-72",
          panelClassName,
        )}
      >
        <div className="flex items-center gap-1.5 border border-border rounded px-2 py-1 bg-muted">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder={searchPlaceholder || "Search..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-[10px] bg-transparent outline-none border-none placeholder:text-muted-foreground p-0 h-4 normal-case"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border max-h-48 pr-0.5">
          {placeholder !== undefined && (
            <button
              type="button"
              onClick={() => pick("")}
              className="w-full text-left py-1 px-1 hover:bg-accent cursor-pointer text-[10px] text-muted-foreground font-medium truncate"
            >
              {placeholder}
            </button>
          )}
          {visibleOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              className={cn(
                "w-full text-left py-1 px-1 hover:bg-accent cursor-pointer text-[10px] font-medium truncate flex items-center justify-between gap-2",
                opt === value ? "text-blue-600 dark:text-blue-300 font-bold" : "text-foreground",
              )}
              title={optionLabels?.[opt] ?? opt}
            >
              <span className="truncate flex-1">{optionLabels?.[opt] ?? opt}</span>
              {opt === value && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
          {visibleOptions.length === 0 && (
            <div className="py-2 px-3 text-xs text-muted-foreground italic">No options found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
