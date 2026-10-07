"use client";

import React from "react";
import { X } from "lucide-react";

interface DateRangeColumnFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onClear: () => void;
}

export const DateRangeColumnFilter: React.FC<DateRangeColumnFilterProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
}) => {
  return (
    <div className="column-date-filter" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <input
        type="date"
        className="date-filter-input"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        title="Start Date"
      />
      <span className="date-filter-to">to</span>
      <input
        type="date"
        className="date-filter-input"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        title="End Date"
      />
      {(startDate || endDate) && (
        <button
          className="date-filter-clear-btn"
          onClick={onClear}
          title="Clear date filter"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
