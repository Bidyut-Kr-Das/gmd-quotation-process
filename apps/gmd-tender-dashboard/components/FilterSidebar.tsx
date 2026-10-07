"use client";
import React, { useRef, useState, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParticipationCards } from "@/components/tender-viewer/participation-cards";
import { ParticipationFlowChart } from "@/components/ParticipationFlowChart";
import { useAppSelector } from "@/lib/hooks";
import "./FilterSidebar.css";

interface FilterSidebarProps {
  priceBasisFilter: string;
  setPriceBasisFilter: (val: string) => void;
  aluminiumMin: string;
  setAluminiumMin: (val: string) => void;
  aluminiumMax: string;
  setAluminiumMax: (val: string) => void;
  copperMin: string;
  setCopperMin: (val: string) => void;
  copperMax: string;
  setCopperMax: (val: string) => void;
  rows?: Record<string, unknown>[];
  filteredRows?: Record<string, unknown>[];
  associationFilter?: string | null;
  onAssociationFilterChange?: (val: string | null) => void;
  showFlowChart?: boolean;
}

// A fresh [] inside a selector is a new reference on every store update,
// which makes useSelector re-render this sidebar on unrelated dispatches.
const EMPTY_ASSOCIATIONS: { id: number; name: string; email: string }[] = [];

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  priceBasisFilter, setPriceBasisFilter,
  aluminiumMin, setAluminiumMin, aluminiumMax, setAluminiumMax,
  copperMin, setCopperMin, copperMax, setCopperMax,
  rows = [],
  filteredRows,
  associationFilter = null,
  onAssociationFilterChange,
  showFlowChart = false,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const associations = useAppSelector((s) => s.tenders.data?.associations) ?? EMPTY_ASSOCIATIONS;

  // Single pass over the rows. This used to scan the whole array once per
  // association, allocating a split/map/filter chain per row per association.
  const personCounts = useMemo(() => {
    if (associations.length === 0) return [];
    const sourceRows = filteredRows ?? rows;
    const countsById = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of sourceRows) {
      const assigned = String(r.assignedTo ?? "");
      if (!assigned) continue;
      seen.clear();
      for (const raw of assigned.split(",")) {
        const id = raw.trim();
        // Dedupe within the row — the old includes() check counted a row once
        // even if it listed the same association twice.
        if (!id || seen.has(id)) continue;
        seen.add(id);
        countsById.set(id, (countsById.get(id) ?? 0) + 1);
      }
    }
    return associations
      .map((a) => ({ ...a, count: countsById.get(String(a.id)) ?? 0 }))
      .filter((p) => p.count > 0);
  }, [rows, filteredRows, associations]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizeMove = (e: MouseEvent) => {
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(200, startWidthRef.current + diff);
    setSidebarWidth(newWidth);
  };

  const handleResizeEnd = () => {
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "";
  };

  return (
    <div className="filter-sidebar-container" style={{ width: sidebarWidth }}>
      <div className="sidebar-header">Participation Filters</div>
      <div className="sidebar-content">
        <ParticipationCards variant="dark" rows={rows} onClearAssociation={() => onAssociationFilterChange?.(null)} />
        {showFlowChart ? (
          <ParticipationFlowChart rows={rows} onClearAssociation={() => onAssociationFilterChange?.(null)} />
        ) : (
          <>
            {/* Assigned To filter - replaces flow chart on executive pages */}
            <div className="filter-section">
              <label className="filter-label">Assigned To</label>
              <Select
                value={associationFilter ?? "all"}
                onValueChange={(v) => onAssociationFilterChange?.(v === "all" ? null : v)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full justify-start gap-2 px-3 py-2 h-auto text-xs font-normal rounded-md bg-white/10 text-white/80 border-white/20 hover:bg-white/20 hover:text-white [&_svg]:text-white/70"
                >
                  <SelectValue placeholder="All People" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All People</SelectItem>
                  {associations.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {personCounts.length > 0 && (
              <div className="filter-section">
                <label className="filter-label">Assigned Tenders by Person</label>
                <div className="space-y-1.5">
                  {personCounts.map((p) => {
                    const isActive = associationFilter === String(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onAssociationFilterChange?.(isActive ? null : String(p.id))}
                        className={`w-full flex items-center justify-between py-2 px-2.5 rounded-lg transition-colors cursor-pointer border text-left ${
                          isActive
                            ? "bg-brand/20 border-brand-accent/50"
                            : "bg-white/10 border-white/10 hover:bg-white/20"
                        }`}
                      >
                        <span className="text-xs text-white/70 truncate pr-2">{p.name}</span>
                        <span className="text-xs font-semibold text-white tabular-nums shrink-0">{p.count}</span>
                      </button>
                    );
                  })}
                </div>
                {associationFilter && (
                  <button
                    type="button"
                    onClick={() => onAssociationFilterChange?.(null)}
                    className="mt-2 text-[10px] font-medium text-white/50 hover:text-white/80 cursor-pointer"
                  >
                    Clear assignment filter
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div className="filter-section">
          <label className="filter-label">Price</label>
          <Select value={priceBasisFilter} onValueChange={(v) => setPriceBasisFilter(v ?? "All")}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="All Prices" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Prices</SelectItem>
              <SelectItem value="Firm">Firm</SelectItem>
              <SelectItem value="Variable">Variable</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="filter-section">
          <label className="filter-label">Aluminium Price Range</label>
          <div className="range-grid">
            <input type="number" className="filter-text-input" placeholder="Min" value={aluminiumMin} onChange={(e) => setAluminiumMin(e.target.value)} min="0" />
            <input type="number" className="filter-text-input" placeholder="Max" value={aluminiumMax} onChange={(e) => setAluminiumMax(e.target.value)} min="0" />
          </div>
        </div>
        <div className="filter-section">
          <label className="filter-label">Copper Price Range</label>
          <div className="range-grid">
            <input type="number" className="filter-text-input" placeholder="Min" value={copperMin} onChange={(e) => setCopperMin(e.target.value)} min="0" />
            <input type="number" className="filter-text-input" placeholder="Max" value={copperMax} onChange={(e) => setCopperMax(e.target.value)} min="0" />
          </div>
        </div>
      </div>
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  );
};
