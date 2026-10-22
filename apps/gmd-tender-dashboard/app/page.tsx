"use client";
import React, { useState, useMemo } from "react";
import { FilterSidebar } from "@/components/FilterSidebar";
import { TenderTable } from "@/components/TenderTable";
import { useAppSelector, useAppDispatch } from "@/lib/hooks";
import { TenderCalculations } from "@/services/tenderCalculations";
import { selectHomeEpcRecords } from "@/lib/selectors/tenderSelectors";
import { matchesRawMaterialRange } from "@/lib/rawMaterials";
import { matchesEpcParticipationFilter } from "@/lib/participationFilter";
import { syncSheetToMerged, searchTendersByPartyThunk } from "@/lib/slices/tendersSlice";
import { Eraser, ExternalLink, Database, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { queueAllCvaParsing } from "@/actions/queueCvaParsing";
import { useSession } from "next-auth/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import "./Dashboard.css";

export default function Home() {
  const referenceDate = useMemo(() => new Date("2026-06-25T12:00:00"), []);
  const dispatch = useAppDispatch();
  const { data: session } = useSession();
  const canSync = session?.user?.role === "admin" || session?.user?.role === "developer";
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
  const mappedRecords = useAppSelector(selectHomeEpcRecords);
  const [clearTrigger, setClearTrigger] = useState<number>(0);
  const [cvaLoading, setCvaLoading] = useState(false);
  const [priceBasisFilter, setPriceBasisFilter] = useState<string>("All");
  const [aluminiumMin, setAluminiumMin] = useState<string>("");
  const [aluminiumMax, setAluminiumMax] = useState<string>("");
  const [copperMin, setCopperMin] = useState<string>("");
  const [copperMax, setCopperMax] = useState<string>("");
  const [associationFilter, setAssociationFilter] = useState<string | null>(null);
  const [partyQuery, setPartyQuery] = useState("");
  const [partySearchField, setPartySearchField] = useState<"erpPartyName" | "itemCode">("erpPartyName");
  const partySearch = useAppSelector((s) => s.tenders.partySearch);

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

  const handleRefresh = async () => {
    const result = await dispatch(syncSheetToMerged());
    if (syncSheetToMerged.rejected.match(result)) {
      console.warn("[Sync] Failed:", result.payload);
    }
  };
  const handleEnrichCva = async () => {
    setCvaLoading(true);
    try {
      const { queued } = await queueAllCvaParsing();
      toast.success(`Queued ${queued} tenders for CVA parsing`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Queue failed");
    } finally {
      setCvaLoading(false);
    }
  };
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
            <h1 className="brand-logo-text">G M DALUI <span>PARTICIPATION</span></h1>
            <div className="brand-divider"></div>
            <span className="brand-title">Executive Tender Dashboard</span>
          </div>
          <div className="header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><Eraser size={14} /> Clear Filters</button>
            {canSync && (
              <button className="erp-sync-btn" onClick={handleRefresh} disabled={loadingTenders} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                {loadingTenders ? <><RefreshCw size={14} /> Refreshing...</> : <><RefreshCw size={14} /> Refresh Dashboard</>}
              </button>
            )}
            <button
              className="erp-sync-btn"
              onClick={() => window.open("https://docs.google.com/spreadsheets/d/1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE", "_blank", "noopener,noreferrer")}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <ExternalLink size={14} /> Open Sheet
            </button>
            <button
              className="erp-sync-btn"
              onClick={handleEnrichCva}
              disabled={cvaLoading}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              {cvaLoading ? <><RefreshCw size={14} className="spin" /> Queuing...</> : <><Database size={14} /> Parse CVA</>}
            </button>
          </div>
        </header>
        <main className="dashboard-body">
          <Tabs defaultValue="pre-participation" className="w-full flex flex-col">
            <TabsList className="w-fit shrink-0">
              <TabsTrigger value="pre-participation">Pre Participation</TabsTrigger>
              <TabsTrigger value="tenders-by-party">Tenders by Party</TabsTrigger>
            </TabsList>
            <TabsContent value="pre-participation" className="mt-2 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col h-[calc(100vh-144px)]">
              {loadingTenders || !tenderSliceData ? (
                <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", minHeight: "500px", color: "var(--color-brand)", fontWeight: 700, flexDirection: "column", gap: "15px" }}>
                  <div style={{ width: "40px", height: "40px", border: "4px solid #e1e6eb", borderTopColor: "var(--color-brand-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></div>
                  <span style={{ fontSize: "16px", letterSpacing: "0.5px" }}>
                    Loading tender data{streamedCount > 0 ? ` (${streamedCount.toLocaleString()} rows)` : ""}...
                  </span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              ) : (
                <TenderTable records={activeDataset} clearTrigger={clearTrigger} showTypeTestColumn
                  aluminiumMin={aluminiumMin} setAluminiumMin={setAluminiumMin} aluminiumMax={aluminiumMax} setAluminiumMax={setAluminiumMax}
                  copperMin={copperMin} setCopperMin={setCopperMin} copperMax={copperMax} setCopperMax={setCopperMax}
                />
              )}
            </TabsContent>
            <TabsContent value="tenders-by-party" className="mt-2 flex flex-1 flex-col gap-3 overflow-auto h-[calc(100vh-144px)]">
              <div className="flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="partySearchField"
                      value="erpPartyName"
                      checked={partySearchField === "erpPartyName"}
                      onChange={() => setPartySearchField("erpPartyName")}
                      className="size-4 accent-brand"
                    />
                    Utility
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="partySearchField"
                      value="itemCode"
                      checked={partySearchField === "itemCode"}
                      onChange={() => setPartySearchField("itemCode")}
                      className="size-4 accent-brand"
                    />
                    Item Code
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      placeholder={partySearchField === "erpPartyName" ? "Search Utility..." : "Search Item Code..."}
                      value={partyQuery}
                      onChange={(e) => setPartyQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (!partyQuery.trim()) return toast.error("Enter search term");
                          dispatch(searchTendersByPartyThunk({ query: partyQuery, field: partySearchField }));
                        }
                      }}
                      className="pl-8"
                    />
                  </div>
                  <Button
                    onClick={() => {
                      if (!partyQuery.trim()) return toast.error("Enter search term");
                      dispatch(searchTendersByPartyThunk({ query: partyQuery, field: partySearchField }));
                    }}
                    disabled={partySearch.loading}
                    className="shrink-0"
                  >
                    {partySearch.loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Search
                  </Button>
                </div>
              </div>
              {partySearch.loading ? (
                <div className="flex flex-1 items-center justify-center min-h-[300px] text-sm text-muted-foreground">Searching...</div>
              ) : partySearch.error ? (
                <div className="flex flex-1 items-center justify-center min-h-[300px] text-sm text-red-600">{partySearch.error}</div>
              ) : partySearch.results.length > 0 ? (
                <TenderTable
                  records={partySearch.results as unknown as import("@/types/tender").EpcTenderRecord[]}
                  variant="party"
                  readOnly
                />
              ) : partySearch.lastQuery ? (
                <div className="flex flex-1 items-center justify-center min-h-[300px] rounded-lg border border-dashed bg-white">
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-700">No results</p>
                    <p className="text-xs text-slate-500 mt-1">No tenders found for &quot;{partySearch.lastQuery}&quot;</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center min-h-[300px] rounded-lg border border-dashed bg-white">
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-700">Tenders by Party</p>
                    <p className="text-xs text-slate-500 mt-1">Select field and search to view results.</p>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
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
