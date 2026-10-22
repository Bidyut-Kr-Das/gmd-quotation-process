"use client";
import React, { useState, useMemo } from "react";
import { FilterSidebar } from "@/components/FilterSidebar";
import { TenderTable } from "@/components/TenderTable";
import { useAppSelector } from "@/lib/hooks";
import { TenderCalculations } from "@/services/tenderCalculations";
import { selectPostParticipationEpcRecords } from "@/lib/selectors/tenderSelectors";
import { matchesRawMaterialRange } from "@/lib/rawMaterials";
import { epcRecordToParticipationRow, matchesEpcParticipationFilter } from "@/lib/participationFilter";
import { deadlineMatchesRange } from "@/components/tender-viewer/participation-cards";
import { Eraser, ExternalLink } from "lucide-react";
import "../Dashboard.css";

export default function PostParticipation() {
  const referenceDate = useMemo(() => new Date("2026-06-25T12:00:00"), []);
  const tenderSliceData = useAppSelector((s) => s.tenders.data);
  const loadingTenders = useAppSelector((s) => s.tenders.loading);
  // Progress counter lives outside `tenders.data`, so ticking it does not
  // invalidate the derived-state chain below.
  const streamedCount = useAppSelector((s) => s.tenders.streamedCount);
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );
  const participatedDateRange = useAppSelector(
    (s) => s.filters.participatedDateRange,
  );
  // Filtering + mapping lives in a module-scope memoised selector so it is not
  // recomputed over ~34k rows every time this route is re-mounted.
  const mappedRecords = useAppSelector(selectPostParticipationEpcRecords);
  const [clearTrigger, setClearTrigger] = useState<number>(0);
  const [priceBasisFilter, setPriceBasisFilter] = useState<string>("All");
  const [aluminiumMin, setAluminiumMin] = useState<string>("");
  const [aluminiumMax, setAluminiumMax] = useState<string>("");
  const [copperMin, setCopperMin] = useState<string>("");
  const [copperMax, setCopperMax] = useState<string>("");

  const calculations = useMemo(() => new TenderCalculations(mappedRecords, referenceDate), [mappedRecords, referenceDate]);
  const primaryDataset = useMemo(() => calculations.getPrimaryDataset(), [calculations]);

  const activeDataset = useMemo(() => {
    const filtered = primaryDataset.filter(record => {
      if (participatedDateRange?.from || participatedDateRange?.to) {
        const row = epcRecordToParticipationRow(record);
        if (!deadlineMatchesRange(row, participatedDateRange.from, participatedDateRange.to)) return false;
      }
      if (priceBasisFilter !== "All") {
        const basis = (record.price || "Firm").toString().toLowerCase();
        if (basis !== priceBasisFilter.toLowerCase()) return false;
      }
      if (!matchesRawMaterialRange(record, { aluMin: aluminiumMin, aluMax: aluminiumMax, cuMin: copperMin, cuMax: copperMax })) return false;
      return true;
    });
    if (participationFilters.length === 0) return filtered;
    return filtered.filter((record) =>
      matchesEpcParticipationFilter(record, participationFilters),
    );
  }, [primaryDataset, priceBasisFilter, aluminiumMin, aluminiumMax, copperMin, copperMax, participationFilters, participatedDateRange]);

  const handleClearAllFilters = () => {
    setPriceBasisFilter("All");
    setAluminiumMin(""); setAluminiumMax("");
    setCopperMin(""); setCopperMax("");
    setClearTrigger(prev => prev + 1);
  };

  return (
    <div className="dashboard-layout-container">
      <div className="dashboard-sidebar-wrapper">
        <FilterSidebar
          showFlowChart
          priceBasisFilter={priceBasisFilter} setPriceBasisFilter={setPriceBasisFilter}
          aluminiumMin={aluminiumMin} setAluminiumMin={setAluminiumMin} aluminiumMax={aluminiumMax} setAluminiumMax={setAluminiumMax}
          copperMin={copperMin} setCopperMin={setCopperMin} copperMax={copperMax} setCopperMax={setCopperMax}
          rows={tenderSliceData?.rows ?? []}
        />
      </div>
      <div className="dashboard-workspace">
        <header className="dashboard-top-header">
          <div className="header-brand">
            <h1 className="brand-logo-text">G M DALUI <span>POST PARTICIPATION</span></h1>
            <div className="brand-divider"></div>
            <span className="brand-title">Post Participation Dashboard</span>
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
              <TenderTable records={activeDataset} clearTrigger={clearTrigger} readOnly={true} editableColumns={["participated", "nextAction", "remarks", "tenderUpdateStatus", "currentStatus", "ourRank", "ourValue", "nameOfRank1", "valueOfRank1", "differenceBetweenRank1", "nameOfRank2", "valueOfRank2", "differenceBetweenRank2", "reverseAuctionApplicable", "reverseAuctionStartDate", "expectedRaDate"]} showPostParticipationColumns={true}
                aluminiumMin={aluminiumMin} setAluminiumMin={setAluminiumMin} aluminiumMax={aluminiumMax} setAluminiumMax={setAluminiumMax}
                copperMin={copperMin} setCopperMin={setCopperMin} copperMax={copperMax} setCopperMax={setCopperMax}
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
