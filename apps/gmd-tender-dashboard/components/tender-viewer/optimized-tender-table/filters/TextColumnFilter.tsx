"use client";

import React from "react";

interface TextColumnFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const TextColumnFilter: React.FC<TextColumnFilterProps> = ({
  value,
  onChange,
  placeholder = "Search...",
}) => {
  return (
    <div 
      className="column-text-filter"
      onClick={(e) => e.stopPropagation()} 
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        className="text-filter-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};
