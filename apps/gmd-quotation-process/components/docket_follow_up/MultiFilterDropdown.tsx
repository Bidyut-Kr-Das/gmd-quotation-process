"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Check, X, Search } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface MultiFilterDropdownProps {
  label: string;
  options: FilterOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  showSearch?: boolean;
  placeholder?: string;
  className?: string;
}

export function MultiFilterDropdown({
  label,
  options,
  selectedValues,
  onChange,
  showSearch = true,
  placeholder = "Search...",
  className = "",
}: MultiFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const handleToggle = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const handleSelectAll = () => {
    const allFilteredValues = filteredOptions.map((opt) => opt.value);
    const newSelected = Array.from(new Set([...selectedValues, ...allFilteredValues]));
    onChange(newSelected);
  };

  const handleClear = () => {
    if (searchQuery.trim()) {
      const filteredSet = new Set(filteredOptions.map((opt) => opt.value));
      onChange(selectedValues.filter((v) => !filteredSet.has(v)));
    } else {
      onChange([]);
    }
  };

  const hasSelection = selectedValues.length > 0;

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
          hasSelection
            ? "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-700 shadow-xs"
            : "bg-background text-foreground border-border hover:bg-muted/60"
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-semibold text-[11px] truncate">{label}</span>
          {hasSelection && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white leading-none">
              {selectedValues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasSelection && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 cursor-pointer"
              title="Clear selection"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 mt-1 w-64 sm:w-72 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-2 space-y-2 animate-in fade-in-50 zoom-in-95">
          {/* Header & Quick Action Buttons */}
          <div className="flex items-center justify-between pb-1.5 border-b border-border/80 text-[11px]">
            <span className="font-bold text-foreground">
              {label} ({selectedValues.length} selected)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[10.5px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 cursor-pointer"
              >
                Select All
              </button>
              <span className="text-muted-foreground/40">|</span>
              <button
                type="button"
                onClick={handleClear}
                className="text-[10.5px] font-semibold text-rose-600 hover:text-rose-800 dark:text-rose-400 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Search Box */}
          {showSearch && options.length > 5 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full pl-7 pr-2 py-1 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Options Checklist */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No items match "{searchQuery}"
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleToggle(opt.value)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                      isSelected
                        ? "bg-blue-50/80 dark:bg-blue-950/60 font-medium text-blue-950 dark:text-blue-200"
                        : "hover:bg-muted/60 text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-border bg-background"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className="truncate" title={opt.label}>
                        {opt.label}
                      </span>
                    </div>
                    {opt.count != null && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground shrink-0">
                        {opt.count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Done Button */}
          <div className="pt-1.5 border-t border-border/80 flex justify-end">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] rounded-md transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
