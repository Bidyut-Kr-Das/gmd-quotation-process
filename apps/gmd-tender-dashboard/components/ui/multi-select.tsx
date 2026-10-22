"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CheckCheck, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  value: string[];
  onChange: (values: string[]) => void;
  options: { value: string; label: string }[];
  title?: string;
  placeholder?: string;
  showCount?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  includeBlank?: boolean;
  align?: "start" | "center" | "end";
  onSearchChange?: (text: string) => void;
  /** Fires when the dropdown opens - used to fetch options on demand. */
  onOpen?: () => void;
  triggerIcon?: React.ReactNode;
  triggerClassName?: string;
  className?: string;
}

const FLUSH_DELAY = 250;

export const MultiSelect: React.FC<MultiSelectProps> = ({
  value,
  onChange,
  options,
  title = "Select",
  placeholder = "All",
  showCount = true,
  searchable = false,
  searchPlaceholder = "Search...",
  emptyText = "No items found.",
  includeBlank = true,
  align = "start",
  onSearchChange,
  onOpen,
  triggerIcon = <ChevronDown className="size-3.5 shrink-0 opacity-60" />,
  triggerClassName,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(value);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const pendingRef = useRef<string[]>(value);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelected(value);
    pendingRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const scheduleFlush = useCallback((next: string[]) => {
    pendingRef.current = next;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      onChangeRef.current(pendingRef.current);
    }, FLUSH_DELAY);
  }, []);

  const allOptions = useMemo(() => {
    const hasBlank = options.some((o) => o.value === "__blank__");
    return includeBlank && !hasBlank
      ? [...options, { value: "__blank__", label: "Blank" }]
      : options;
  }, [options, includeBlank]);

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [allOptions, search]);

  const toggle = useCallback(
    (optValue: string) => {
      const cur = pendingRef.current;
      const next = cur.includes(optValue)
        ? cur.filter((v) => v !== optValue)
        : [...cur, optValue];
      setSelected(next);
      scheduleFlush(next);
    },
    [scheduleFlush],
  );

  const handleSelectAll = useCallback(() => {
    const next = visibleOptions.map((o) => o.value);
    setSelected(next);
    scheduleFlush(next);
  }, [visibleOptions, scheduleFlush]);

  const handleClear = useCallback(() => {
    setSelected([]);
    scheduleFlush([]);
  }, [scheduleFlush]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    if (!onSearchChangeRef.current) return;
    // filter text-mode: typing clears selection, debounced external search
    setSelected([]);
    pendingRef.current = [];
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      onSearchChangeRef.current?.(text);
    }, FLUSH_DELAY);
  }, []);

  const handleOpenChange = useCallback((o: boolean) => {
    setOpen(o);
    if (o) onOpenRef.current?.();
    if (!o) setSearch("");
  }, []);

  const triggerLabel =
    showCount && selected.length > 0
      ? `${selected.length} selected`
      : placeholder;

  return (
    <div
      className={cn("column-picker-container", className)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn("column-picker-btn", triggerClassName)}
            >
              {triggerIcon}
              <span className="truncate">{triggerLabel}</span>
            </button>
          }
        />
        <PopoverContent
          align={align}
          className="column-picker-dropdown column-picker-dropdown--enhanced !w-[280px] !gap-0 !p-2 !rounded-[4px] !ring-0"
        >
          <p className="column-picker-header">
            <span>{title}</span>
            <span className="column-picker-count">
              {selected.length}/{options.length}
            </span>
          </p>
          {searchable && (
            <div className="column-picker-search">
              <Search size={14} className="column-picker-search-icon" />
              <input
                type="text"
                className="column-picker-search-input"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  className="column-picker-search-clear"
                  onClick={() => handleSearch("")}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="column-picker-actions">
            <button
              type="button"
              className="column-picker-action-btn"
              onClick={handleSelectAll}
            >
              <CheckCheck size={12} /> Select All
            </button>
            <button
              type="button"
              className="column-picker-action-btn"
              onClick={handleClear}
            >
              <X size={12} /> Clear
            </button>
          </div>
          <div className="column-picker-list">
            {visibleOptions.length === 0 ? (
              <p className="column-picker-empty">{emptyText}</p>
            ) : (
              visibleOptions.map((opt) => (
                <label key={opt.value} className="column-picker-item">
                  <input
                    type="checkbox"
                    className="column-picker-checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                  />
                  {opt.label}
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};