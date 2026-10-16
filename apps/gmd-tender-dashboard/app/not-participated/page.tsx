"use client";
import React, { useState, useMemo } from "react";
import { FilterSidebar } from "@/components/FilterSidebar";
import { TenderTable } from "@/components/TenderTable";
import { useAppSelector } from "@/lib/hooks";
import { TenderCalculations } from "@/services/tenderCalculations";
import { selectNotParticipatedEpcRecords } from "@/lib/selectors/tenderSelectors";
import { matchesRawMaterialRange } from "@/lib/rawMaterials";
import { matchesEpcParticipationFilter } from "@/lib/participationFilter";
import { Eraser, ExternalLink } from "lucide-react";
import "../Dashboard.css";

export default function NotParticipated() {
  const referenceDate = useMemo(() => new Date(), []);
  const tenderSliceData = useAppSelector((s) => s.tenders.data);
  const loadingTenders = useAppSelector((s) => s.tenders.loading);
  // Progress counter lives outside `tenders.data`, so ticking it does not
  // invalidate the derived-state chain below.
  const streamedCount = useAppSelector((s) => s.tenders.streamedCount);
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );
  // Filtering + mapping lives in a module-scope memoised selector so it is not
  // recomputed over ~34k rows every time this route is re-mounted.
  const mappedRecords = useAppSelector(selectNotParticipatedEpcRecords);
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  const [clearTrigger, setClearTrigger] = useState<number>(0);
  const [priceBasisFilter, setPriceBasisFilter] = useState<string>("All");
  const [aluminiumMin, setAluminiumMin] = useState<string>("");
  const [aluminiumMax, setAluminiumMax] = useState<string>("");
  const [copperMin, setCopperMin] = useState<string>("");
  const [copperMax, setCopperMax] = useState<string>("");
  const [associationFilter, setAssociationFilter] = useState<string | null>(null);

  const calculations = useMemo(() => new TenderCalculations(mappedRecords, referenceDate), [mappedRecords, referenceDate]);
  const primaryDataset = useMemo(() => calculations.getPrimaryDataset(), [calculations]);

  const baseFiltered = useMemo(() => {
    let filtered = primaryDataset.filter(record => {
      if (priceBasisFilter !== "All") {
        const basis = (record.price || "Firm").toString().toLowerCase();
        if (basis !== priceBasisFilter.toLowerCase()) return false;
      }
      if (!matchesRawMaterialRange(record, { aluMin: aluminiumMin, aluMax: aluminiumMax, cuMin: copperMin, cuMax: copperMax })) return false;
      return true;
    });
    if (participationFilters.length > 0) {
      filtered = filtered.filter((record) =>
        matchesEpcParticipationFilter(record, participationFilters),
      );
    }
    return filtered;
  }, [primaryDataset, priceBasisFilter, aluminiumMin, aluminiumMax, copperMin, copperMax, participationFilters]);

  const filteredRowsForSidebar = useMemo(() => baseFiltered as unknown as Record<string, unknown>[], [baseFiltered]);

  const activeDataset = useMemo(() => {
    if (!associationFilter) return baseFiltered;
    return baseFiltered.filter((record) => {
      const ids = String((record as unknown as Record<string, unknown>).assignedTo ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.includes(associationFilter);
    });
  }, [baseFiltered, associationFilter]);

  const handleClearAllFilters = () => {
    setPriceBasisFilter("All");
    setAluminiumMin(""); setAluminiumMax("");
    setCopperMin(""); setCopperMax("");
    setAssociationFilter(null);
    setClearTrigger(prev => prev + 1);
  };

  return (
    <div className="dashboard-layout-container">
      <div className="dashboard-sidebar-wrapper">
        <FilterSidebar
          priceBasisFilter={priceBasisFilter} setPriceBasisFilter={setPriceBasisFilter}
          aluminiumMin={aluminiumMin} setAluminiumMin={setAluminiumMin} aluminiumMax={aluminiumMax} setAluminiumMax={setAluminiumMax}
          copperMin={copperMin} setCopperMin={setCopperMin} copperMax={copperMax} setCopperMax={setCopperMax}
          rows={tenderSliceData?.rows ?? []}
          filteredRows={filteredRowsForSidebar}
          associationFilter={associationFilter} onAssociationFilterChange={setAssociationFilter}
        />
      </div>
      <div className="dashboard-workspace">
        <header className="dashboard-top-header">
          <div className="header-brand">
            <h1 className="brand-logo-text">NOT PARTICIPATED</h1>
            <div className="brand-divider"></div>
            <span className="brand-title">Not Participated Dashboard</span>
          </div>
          <div className="header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><Eraser size={14} /> Clear Filters</button>
            <button
              className="erp-sync-btn"
              onClick={() => window.open("https://docs.google.com/spreadsheets/d/1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE", "_blank", "noopener,noreferrer")}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <ExternalLink size={14} /> Open Sheet
            </button>
          </div>
        </header>
        <main className="dashboard-body">
          {loadingTenders || !tenderSliceData ? (
            <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", minHeight: "500px", color: "var(--color-brand)", fontWeight: 700, flexDirection: "column", gap: "15px" }}>
              <div style={{ width: "40px", height: "40px", border: "4px solid #e1e6eb", borderTopColor: "var(--color-brand-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></div>
              <span style={{ fontSize: "16px", letterSpacing: "0.5px" }}>
                Loading tender data{streamedCount > 0 ? ` (${streamedCount.toLocaleString()} rows)` : ""}...
              </span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              <TenderTable records={activeDataset} clearTrigger={clearTrigger} readOnly={true} editableColumns={["participated", "reason"]} showPostParticipationColumns={true} showDeadlineOverBadge showReasonColumn
                aluminiumMin={aluminiumMin} setAluminiumMin={setAluminiumMin} aluminiumMax={aluminiumMax} setAluminiumMax={setAluminiumMax}
                copperMin={copperMin} setCopperMin={setCopperMin} copperMax={copperMax} setCopperMax={setCopperMax}
                defaultEndDate={todayStr}
              />
            </>
          )}
        </main>
        <footer className="dashboard-status-bar">
          <div className="status-left">
            <div className="sync-live-tag" style={{ color: "#137333" }}>
              <span className="sync-pulse-dot" style={{ backgroundColor: "#34a853" }}></span>
              <span>DATABASE LIVE (SYNC: ACTIVE)</span>
            </div>
          </div>
          <div className="status-center">G M DALUI LIVE GOOGLE SHEET PIPELINE ACTIVE</div>
          <div className="status-right">
            <a className="status-link">SYSTEM DOCUMENTATION</a>
            <span>•</span>
            <a className="status-link">AUDIT LOGS</a>
            <span className="version-badge">G M DALUI ERP V2.1 PRO</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
