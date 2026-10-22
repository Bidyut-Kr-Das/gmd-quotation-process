"use client";

import React from "react";

interface BooleanColumnFilterProps {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}

export const BooleanColumnFilter: React.FC<BooleanColumnFilterProps> = ({
  value,
  onChange,
}) => {
  return (
    <div 
      className="column-boolean-filter"
      onClick={(e) => e.stopPropagation()} 
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className={`boolean-filter-btn ${value === null ? "active" : ""}`}
        onClick={() => onChange(null)}
        title="All"
      >
        All
      </button>
      <button
        className={`boolean-filter-btn ${value === true ? "active" : ""}`}
        onClick={() => onChange(true)}
        title="Yes"
      >
        Yes
      </button>
      <button
        className={`boolean-filter-btn ${value === false ? "active" : ""}`}
        onClick={() => onChange(false)}
        title="No"
      >
        No
      </button>
    </div>
  );
};
