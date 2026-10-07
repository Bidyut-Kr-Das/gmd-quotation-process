"use client";

import { useState } from "react";
import { ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";

type DatePreset = "thisWeek" | "thisMonth" | "thisYear";

interface DateRangeFilterProps {
  /** Currently active preset */
  preset: DatePreset | null;
  /** Custom range start (ISO string) */
  dateFrom: string | null;
  /** Custom range end (ISO string) */
  dateTo: string | null;
  onPresetChange: (preset: DatePreset | null) => void;
  onDateRangeChange: (from: string | null, to: string | null) => void;
  onClear: () => void;
  /** Whether the filter is currently active */
  isActive?: boolean;
}

/**
 * Render this component inside a table header cell to enable date range filtering.
 * It renders a filter icon button that opens a popover with presets and a calendar picker.
 */
export function DateRangeFilter({
  preset,
  dateFrom,
  dateTo,
  onPresetChange,
  onDateRangeChange,
  onClear,
  isActive,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const active = isActive ?? !!(preset || dateFrom);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          const rect = (
            e.currentTarget as HTMLElement
          ).getBoundingClientRect();
          setPickerPos({
            top: rect.bottom + 4,
            left: Math.max(8, rect.left - 120),
          });
          setOpen((v) => !v);
        }}
        className={cn(
          "size-3.5 flex items-center justify-center rounded cursor-pointer",
          active
            ? "text-primary/80"
            : "text-white/60 hover:text-white/80",
        )}
      >
        <ListFilter className="size-3" />
      </button>

      {open && pickerPos && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setPickerPos(null);
            }}
          />
          <div
            className="fixed z-50 rounded-sm bg-white shadow-md ring-1 ring-slate-200 p-3"
            style={{ top: pickerPos.top, left: pickerPos.left }}
          >
            <p className="text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
              Quick Select
            </p>
            <div className="flex gap-1 mb-3">
              {(["thisWeek", "thisMonth", "thisYear"] as const).map(
                (p) => (
                  <Button
                    key={p}
                    size="xs"
                    variant={preset === p ? "default" : "outline"}
                    onClick={() => {
                      onPresetChange(preset === p ? null : p);
                      setOpen(false);
                    }}
                    className="flex-1 text-xs"
                  >
                    {p === "thisWeek"
                      ? "Week"
                      : p === "thisMonth"
                        ? "Month"
                        : "Year"}
                  </Button>
                ),
              )}
            </div>
            <p className="text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
              Custom Range
            </p>
            <Calendar
              mode="range"
              defaultMonth={new Date()}
              selected={
                dateFrom
                  ? {
                      from: new Date(dateFrom),
                      to: dateTo ? new Date(dateTo) : undefined,
                    }
                  : undefined
              }
              onSelect={(range) => {
                if (range?.from && range?.to) {
                  onDateRangeChange(
                    range.from.toISOString(),
                    range.to.toISOString(),
                  );
                }
              }}
              numberOfMonths={2}
            />
            {(preset || dateFrom) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  onClear();
                  setPickerPos(null);
                  setOpen(false);
                }}
                className="mt-2 w-full text-xs"
              >
                Clear Filter
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
