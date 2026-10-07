"use client";

import { useState, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  setTypeFilter,
  setExclusionFilter,
  setDeadlinePreset,
  setDeadlineDateRange,
  clearDeadlineFilter,
  setAiRelevanceFilter,
  setShowFilterTray,
  resetAllFilters,
} from "@/lib/slices/filtersSlice";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
} from "date-fns";
import { cn, formatDate } from "@/lib/utils";
import { RotateCcw, ListFilter } from "lucide-react";

export default function FilterTray() {
  const dispatch = useAppDispatch();
  const typeFilter = useAppSelector((s) => s.filters.typeFilter);
  const exclusionFilter = useAppSelector((s) => s.filters.exclusionFilter);
  const deadlinePreset = useAppSelector((s) => s.filters.deadlinePreset);
  const deadlineDateFrom = useAppSelector((s) => s.filters.deadlineDateFrom);
  const deadlineDateTo = useAppSelector((s) => s.filters.deadlineDateTo);
  const aiRelevanceFilter = useAppSelector((s) => s.filters.aiRelevanceFilter);

  const [showDeadlinePopup, setShowDeadlinePopup] = useState(false);

  const hasActiveFilters = useMemo(() => {
    return (
      typeFilter !== "all" ||
      exclusionFilter !== null ||
      deadlinePreset !== null ||
      deadlineDateFrom !== null ||
      aiRelevanceFilter !== "all"
    );
  }, [typeFilter, exclusionFilter, deadlinePreset, deadlineDateFrom, aiRelevanceFilter]);

  const deadlineLabel = useMemo(() => {
    if (deadlinePreset === "thisWeek") return "This Week";
    if (deadlinePreset === "thisMonth") return "This Month";
    if (deadlinePreset === "thisYear") return "This Year";
    if (deadlineDateFrom && deadlineDateTo) {
      return `${formatDate(deadlineDateFrom)} - ${formatDate(deadlineDateTo)}`;
    }
    if (deadlineDateFrom) {
      return formatDate(deadlineDateFrom);
    }
    return null;
  }, [deadlinePreset, deadlineDateFrom, deadlineDateTo]);

  const handleReset = () => {
    dispatch(resetAllFilters());
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider w-24 shrink-0">
            Type
          </span>
          <div className="flex gap-1">
            {(["all", "Gem", "Non-Gem"] as const).map((key) => (
              <Button
                key={key}
                size="xs"
                variant={typeFilter === key ? "default" : "outline"}
                onClick={() => dispatch(setTypeFilter(key))}
                className={cn(
                  "text-xs capitalize",
                  typeFilter === key && "bg-brand-light text-brand hover:bg-brand-light",
                )}
              >
                {key === "all" ? "All" : key}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider w-24 shrink-0">
            Hide
          </span>
          <div className="flex gap-1">
            {(["cable", "conductors", "both"] as const).map((key) => (
              <Button
                key={key}
                size="xs"
                variant={exclusionFilter === key ? "default" : "outline"}
                onClick={() => dispatch(setExclusionFilter(exclusionFilter === key ? null : key))}
                className={cn(
                  "text-xs capitalize",
                  exclusionFilter === key && "bg-brand-light text-brand hover:bg-brand-light",
                )}
              >
                {key === "both" ? "Both" : key}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider w-24 shrink-0">
            Deadline
          </span>
          <div className="flex gap-1">
            {(["thisWeek", "thisMonth", "thisYear"] as const).map((preset) => (
              <Button
                key={preset}
                size="xs"
                variant={deadlinePreset === preset ? "default" : "outline"}
                onClick={() => dispatch(setDeadlinePreset(deadlinePreset === preset ? null : preset))}
                className={cn(
                  "text-xs",
                  deadlinePreset === preset && "bg-brand-light text-brand hover:bg-brand-light",
                )}
              >
                {preset === "thisWeek" ? "This Week" : preset === "thisMonth" ? "This Month" : "This Year"}
              </Button>
            ))}
            <div className="relative">
              <Button
                size="xs"
                variant={deadlineDateFrom ? "default" : "outline"}
                onClick={() => setShowDeadlinePopup((v) => !v)}
                className={cn(
                  "text-xs",
                  deadlineDateFrom && "bg-brand-light text-brand hover:bg-brand-light",
                )}
              >
                <ListFilter className="size-3" />
                {deadlineLabel ?? "Custom"}
              </Button>
              {showDeadlinePopup && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDeadlinePopup(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 rounded-sm bg-white shadow-md ring-1 ring-slate-200 p-3">
                    <Calendar
                      mode="range"
                      defaultMonth={new Date()}
                      selected={
                        deadlineDateFrom
                          ? { from: new Date(deadlineDateFrom), to: deadlineDateTo ? new Date(deadlineDateTo) : undefined }
                          : undefined
                      }
                      onSelect={(range) => {
                        if (range?.from && range?.to) {
                          dispatch(setDeadlineDateRange({
                            from: range.from.toISOString(),
                            to: range.to.toISOString(),
                          }));
                        }
                      }}
                      numberOfMonths={2}
                    />
                    {(deadlinePreset || deadlineDateFrom) && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          dispatch(clearDeadlineFilter());
                          setShowDeadlinePopup(false);
                        }}
                        className="mt-2 w-full text-xs"
                      >
                        Clear Filter
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider w-24 shrink-0">
            AI Relevance
          </span>
          <div className="flex gap-1">
            {(["all", "yes", "no", "not_analysed"] as const).map((key) => (
              <Button
                key={key}
                size="xs"
                variant={aiRelevanceFilter === key ? "default" : "outline"}
                onClick={() => dispatch(setAiRelevanceFilter(key))}
                className={cn(
                  "text-xs",
                  aiRelevanceFilter === key && "bg-brand-light text-brand hover:bg-brand-light",
                )}
              >
                {key === "all" ? "All" : key === "yes" ? "Yes" : key === "no" ? "No" : "Not Analysed"}
              </Button>
            ))}
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-4">
            <span className="w-24" />
            <Button
              size="xs"
              variant="ghost"
              onClick={handleReset}
              className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
            >
              <RotateCcw className="size-3" />
              Reset all filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
