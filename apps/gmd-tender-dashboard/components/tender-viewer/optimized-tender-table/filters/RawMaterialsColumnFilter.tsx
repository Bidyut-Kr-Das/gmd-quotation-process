"use client";

import React from "react";

export interface RawMaterialsRangeFilterValue {
  aluMin: string;
  aluMax: string;
  cuMin: string;
  cuMax: string;
}

interface RawMaterialsColumnFilterProps {
  value?: Partial<RawMaterialsRangeFilterValue>;
  onChange: (value: RawMaterialsRangeFilterValue) => void;
}

export const RawMaterialsColumnFilter: React.FC<RawMaterialsColumnFilterProps> = ({
  value,
  onChange,
}) => {
  const aluMin = value?.aluMin ?? "";
  const aluMax = value?.aluMax ?? "";
  const cuMin = value?.cuMin ?? "";
  const cuMax = value?.cuMax ?? "";

  const update = (patch: Partial<RawMaterialsRangeFilterValue>) =>
    onChange({
      aluMin,
      aluMax,
      cuMin,
      cuMax,
      ...patch,
    });

  return (
    <div
      className="column-raw-materials-filter"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="raw-mat-row">
        <span className="raw-mat-label">Alu</span>
        <input
          type="number"
          placeholder="Min"
          className="raw-mat-input"
          value={aluMin}
          onChange={(e) => update({ aluMin: e.target.value })}
          title="Aluminium Min"
        />
        <span className="raw-mat-dash">-</span>
        <input
          type="number"
          placeholder="Max"
          className="raw-mat-input"
          value={aluMax}
          onChange={(e) => update({ aluMax: e.target.value })}
          title="Aluminium Max"
        />
      </div>
      <div className="raw-mat-row">
        <span className="raw-mat-label">Cu</span>
        <input
          type="number"
          placeholder="Min"
          className="raw-mat-input"
          value={cuMin}
          onChange={(e) => update({ cuMin: e.target.value })}
          title="Copper Min"
        />
        <span className="raw-mat-dash">-</span>
        <input
          type="number"
          placeholder="Max"
          className="raw-mat-input"
          value={cuMax}
          onChange={(e) => update({ cuMax: e.target.value })}
          title="Copper Max"
        />
      </div>
    </div>
  );
};
