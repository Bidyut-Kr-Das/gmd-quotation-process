"use client";

import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useEmdDetailsCash, EmdDetailsCashRecord } from "@/hooks/useEmdDetailsCash";
import { EmdCashSidebar, EmdStatus, EmdStats } from "@/components/emd-cash/EmdCashSidebar";
import { RefreshCw, Eraser, Search, Download, FileSpreadsheet, ChevronUp, ChevronDown, RotateCcw, X, Mail, Loader2, Check, Eye } from "lucide-react";
import { toast } from "sonner";
import { TENDER_REASON_OPTIONS } from "@/lib/emdReasonOptions";
import { EmailDraftDialog } from "@/components/emd/EmailDraftDialog";
import { formatDateTimeIST } from "@/lib/format-ist";
import "@/app/SupplyHistory.css";
import "@/components/TenderTable.css";

function normalizeStatus(v: string | null | undefined): EmdStatus | null {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  if (u === "REFUNDED") return "REFUNDED";
  if (u === "PENDING") return "PENDING";
  if (u === "WRITTEN OFF" || u === "WRITTENOFF" || u === "WRITTEN-OFF") return "WRITTEN OFF";
  return null;
}

function parseEmdAmt(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDateValue(v: unknown): number {
  if (!v) return 0;
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(dt.getTime())) return dt.getTime();
  }
  return 0;
}

type CashColumn = {
  header: string;
  accessor: keyof EmdDetailsCashRecord | "action";
  defaultWidth: number;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  sortable?: boolean;
};

const CASH_COLUMNS: CashColumn[] = [
  { header: "Customer Name", accessor: "customerName", defaultWidth: 220, align: "left", sortable: true },
  { header: "Issue DT", accessor: "issueDt", defaultWidth: 140, align: "center", sortable: true },
  { header: "EMD Amt", accessor: "emdAmt", defaultWidth: 130, align: "right", sortable: true },
  { header: "Permanent (Y/N)", accessor: "permanent", defaultWidth: 130, align: "center" },
  { header: "Tender No", accessor: "tenderNo", defaultWidth: 190, align: "left", sticky: true, sortable: true },
  { header: "CH/DD No", accessor: "chDdNo", defaultWidth: 150, align: "left", sortable: true },
  { header: "A/C Holder", accessor: "acHolder", defaultWidth: 160, align: "left", sortable: true },
  { header: "Status As Per Sujib Da & Other", accessor: "statusAsPerSujibDaAndOther", defaultWidth: 220, align: "left" },
  { header: "Can Be Refunded (Y/N)", accessor: "canBeRefunded", defaultWidth: 150, align: "center" },
  { header: "TM No.", accessor: "tmNo", defaultWidth: 120, align: "left" },
  { header: "Rank", accessor: "rank", defaultWidth: 90, align: "center" },
  { header: "PO Issue Status", accessor: "poIssueStatus", defaultWidth: 150, align: "left" },
  { header: "AOC - Award of Contract Status", accessor: "aocAwardOfContractStatus", defaultWidth: 200, align: "left" },
  { header: "Refundable / Not", accessor: "refundableOrNot", defaultWidth: 140, align: "center" },
  { header: "Refunded / Pending", accessor: "statusRefundedPending", defaultWidth: 150, align: "center", sortable: true },
  { header: "Expected Refund / Refunded Date", accessor: "expectedRefundDateOrRefundedDate", defaultWidth: 170, align: "center", sortable: true },
  { header: "Status of Tender", accessor: "statusOfTender", defaultWidth: 160, align: "left" },
  { header: "Conditions for Refund", accessor: "conditionsForRefund", defaultWidth: 220, align: "left" },
  { header: "Remarks", accessor: "remarks", defaultWidth: 220, align: "left" },
  { header: "Certificate By Party", accessor: "certificateByParty", defaultWidth: 200, align: "left", sortable: true },
  { header: "Certificate By Utility", accessor: "certificateByUtility", defaultWidth: 200, align: "left", sortable: true },
  { header: "Contact Email", accessor: "contactEmailId", defaultWidth: 220, align: "left", sortable: true },
  { header: "Email Draft", accessor: "emailDraft", defaultWidth: 320, align: "left" },
  { header: "Last Email Sent At", accessor: "lastEmailSentAt", defaultWidth: 170, align: "center", sortable: true },
  { header: "Tender Conclusion Reason", accessor: "reason", defaultWidth: 280, align: "left", sortable: true },
  { header: "Action", accessor: "action", defaultWidth: 140, align: "center", sortable: false },
];

const SKIP_FILTER_COLUMNS_CASH = new Set<string>(["action", "emailDraft"]);

export default function EmdDetailsCashPage() {
  const { data, loading, error, refresh } = useEmdDetailsCash();
  const [selectedStatus, setSelectedStatus] = useState<EmdStatus | "ALL">("ALL");
  const [globalSearch, setGlobalSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<keyof EmdDetailsCashRecord | null>("tenderNo");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [columnSearchText, setColumnSearchText] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    CASH_COLUMNS.forEach((c) => (m[String(c.accessor)] = c.defaultWidth));
    return m;
  });

  const [multiSelectFilters, setMultiSelectFilters] = useState<Record<string, string[]>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [localReasonMap, setLocalReasonMap] = useState<Record<string, string | null>>({});
  const [localContactEmailMap, setLocalContactEmailMap] = useState<Record<string, string | null>>({});
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [updatingContactEmailId, setUpdatingContactEmailId] = useState<number | null>(null);
  const [editingContactEmailId, setEditingContactEmailId] = useState<number | null>(null);
  const [draftContactEmail, setDraftContactEmail] = useState<string>("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = (v: string) => v.trim().split(",").map((s) => s.trim()).filter(Boolean).every((e) => EMAIL_RE.test(e));
  const invalidEmails = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean).filter((e) => !EMAIL_RE.test(e));

  const resizingColumnRef = useRef<string | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = (e: React.MouseEvent, accessor: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumnRef.current = accessor;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizingColumnRef.current) return;
      const diff = ev.clientX - startXRef.current;
      const newWidth = Math.max(60, startWidthRef.current + diff);
      setColumnWidths((prev) => ({ ...prev, [resizingColumnRef.current!]: newWidth }));
    };
    const onUp = () => {
      resizingColumnRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "default";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };

  const handleSort = (col: keyof EmdDetailsCashRecord | "action") => {
    if (col === "action") return;
    const cfg = CASH_COLUMNS.find((c) => c.accessor === col);
    if (!cfg?.sortable) return;
    if (sortColumn === col) setSortDirection((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(col as keyof EmdDetailsCashRecord);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const stickyLeftOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    for (const col of CASH_COLUMNS) {
      if (col.sticky) {
        offsets[String(col.accessor)] = acc;
        acc += columnWidths[String(col.accessor)] ?? col.defaultWidth;
      }
    }
    return offsets;
  }, [columnWidths]);

  const mergedData = useMemo(() => {
    if (Object.keys(localReasonMap).length === 0 && Object.keys(localContactEmailMap).length === 0) return data;
    return data.map((r) => {
      let n: any = r;
      if (localReasonMap[String(r.id)] !== undefined) n = { ...n, reason: localReasonMap[String(r.id)] };
      if (localContactEmailMap[String(r.id)] !== undefined) n = { ...n, contactEmailId: localContactEmailMap[String(r.id)] };
      return n;
    });
  }, [data, localReasonMap, localContactEmailMap]);

  const sidebarStats: Record<EmdStatus, EmdStats> = useMemo(() => {
    const init = (): EmdStats => ({ count: 0, totalEmd: 0, customerCount: 0 });
    const map: Record<EmdStatus, EmdStats> = { REFUNDED: init(), PENDING: init(), "WRITTEN OFF": init() };
    const customerSets: Record<EmdStatus, Set<string>> = { REFUNDED: new Set(), PENDING: new Set(), "WRITTEN OFF": new Set() } as any;
    for (const r of mergedData) {
      const k = normalizeStatus(r.statusRefundedPending);
      if (!k) continue;
      map[k].count += 1;
      map[k].totalEmd += parseEmdAmt(r.emdAmt);
      if (r.customerName) customerSets[k].add(r.customerName.trim().toLowerCase());
    }
    for (const k of Object.keys(map) as EmdStatus[]) map[k].customerCount = customerSets[k].size;
    return map;
  }, [mergedData]);

  const statusFiltered = useMemo(() => {
    if (selectedStatus === "ALL") return mergedData;
    return mergedData.filter((r) => normalizeStatus(r.statusRefundedPending) === selectedStatus);
  }, [mergedData, selectedStatus]);

  const handleReasonChange = useCallback(async (id: number, newReason: string) => {
    const prev = (mergedData.find((r) => r.id === id)?.reason ?? null) as string | null;
    setLocalReasonMap((prevMap) => ({ ...prevMap, [String(id)]: newReason || null }));
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/emd-details-cash/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: newReason || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to update reason");
      toast.success("Reason updated");
    } catch (e: any) {
      setLocalReasonMap((prevMap) => ({ ...prevMap, [String(id)]: prev }));
      toast.error(e.message || "Failed to update reason");
    } finally {
      setUpdatingId(null);
    }
  }, [mergedData]);

  const handleContactEmailSave = useCallback(async (id: number) => {
    const raw = draftContactEmail.trim();
    if (raw !== "" && !isValidEmail(raw)) {
      toast.error(`Invalid email(s): ${invalidEmails(raw).join(", ")}`);
      return;
    }
    const prev = (mergedData.find((r) => r.id === id) as any)?.contactEmailId ?? null;
    const next = raw === "" ? null : raw;
    setLocalContactEmailMap((prevMap) => ({ ...prevMap, [String(id)]: next }));
    setUpdatingContactEmailId(id);
    setEditingContactEmailId(null);
    try {
      const res = await fetch(`/api/emd-details-cash/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactEmailId: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to update contact email");
      toast.success("Contact email updated");
    } catch (e: any) {
      setLocalContactEmailMap((prevMap) => ({ ...prevMap, [String(id)]: prev as string | null }));
      toast.error(e.message || "Failed to update contact email");
    } finally {
      setUpdatingContactEmailId(null);
    }
  }, [draftContactEmail, mergedData]);

  const handleContactEmailCancel = useCallback(() => {
    setEditingContactEmailId(null);
    setDraftContactEmail("");
  }, []);

  const handleSendEmail = useCallback(async (row: EmdDetailsCashRecord) => {
    if (!row.reason) {
      toast.error("Please select Tender Conclusion Reason before sending email");
      return;
    }
    toast.info("Work in progress — EMD Cash email sending will be available soon");
  }, []);

  const handleViewDraft = useCallback((row: EmdDetailsCashRecord) => {
    setDraftHtml(row.emailDraft ?? null);
    setDraftTitle(row.tenderNo || row.customerName || String(row.id));
    setDraftOpen(true);
  }, []);

  // Multiselect helpers
  const toggleFilter = useCallback((accessor: string, value: string) => {
    setMultiSelectFilters((prev) => {
      const cur = prev[accessor] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [accessor]: next };
    });
    setCurrentPage(1);
  }, []);

  const clearFilter = useCallback((accessor: string) => {
    setMultiSelectFilters((prev) => {
      const nxt = { ...prev };
      delete nxt[accessor];
      return nxt;
    });
    setCurrentPage(1);
  }, []);

  const selectAllFilter = useCallback((accessor: string, allValues: string[]) => {
    const all = [...allValues, "(Blank)"];
    setMultiSelectFilters((prev) => ({ ...prev, [accessor]: all }));
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      const el = dropdownRefs.current[openDropdown];
      if (el && !el.contains(e.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdown]);

  // Optimized filtering pipeline
  const baseStageFiltered = useMemo(() => {
    let result: EmdDetailsCashRecord[] = statusFiltered;
    if (globalSearch.trim() !== "") {
      const q = globalSearch.toLowerCase().trim();
      result = result.filter((r) =>
        CASH_COLUMNS.some((c) => {
          if (c.accessor === "action") return false;
          const v = (r as any)[c.accessor as keyof EmdDetailsCashRecord];
          if (v == null) return false;
          return String(v).toLowerCase().includes(q);
        })
      );
    }
    return result;
  }, [statusFiltered, globalSearch]);

  type CashPredicate = { key: string; test: (r: EmdDetailsCashRecord) => boolean };
  const columnPredicates = useMemo<CashPredicate[]>(() => {
    const preds: CashPredicate[] = [];
    for (const [accessor, selected] of Object.entries(multiSelectFilters)) {
      if (selected.length === 0) continue;
      preds.push({
        key: accessor,
        test: (r) => {
          const cellStr = String((r as any)[accessor as keyof EmdDetailsCashRecord] ?? "");
          if (!cellStr.trim()) return selected.includes("(Blank)");
          return selected.includes(cellStr);
        },
      });
    }
    for (const [accessor, searchVal] of Object.entries(columnSearchText)) {
      if (!searchVal.trim()) continue;
      const q = searchVal.toLowerCase().trim();
      preds.push({
        key: accessor,
        test: (r) => {
          const v = (r as any)[accessor as keyof EmdDetailsCashRecord];
          if (v == null) return false;
          return String(v).toLowerCase().includes(q);
        },
      });
    }
    return preds;
  }, [multiSelectFilters, columnSearchText]);

  const getFilteredRecordsExcept = useCallback(
    (excludeAccessor: string | null): EmdDetailsCashRecord[] => {
      if (columnPredicates.length === 0) return baseStageFiltered;
      return baseStageFiltered.filter((r) => {
        for (const p of columnPredicates) {
          if (p.key === excludeAccessor) continue;
          if (!p.test(r)) return false;
        }
        return true;
      });
    },
    [baseStageFiltered, columnPredicates]
  );

  const uniqueValueCache = useMemo(() => {
    const cache: Record<string, string[]> = {};
    if (!openDropdown || SKIP_FILTER_COLUMNS_CASH.has(openDropdown)) return cache;
    const set = new Set<string>();
    for (const r of getFilteredRecordsExcept(openDropdown)) {
      const v = String((r as any)[openDropdown as keyof EmdDetailsCashRecord] ?? "");
      if (v.trim() !== "") set.add(v);
    }
    cache[openDropdown] = Array.from(set).sort((a, b) => a.localeCompare(b));
    return cache;
  }, [openDropdown, getFilteredRecordsExcept]);

  const processedRecords = useMemo(() => {
    let result = getFilteredRecordsExcept(null);
    if (sortColumn) {
      result = [...result].sort((a, b) => {
        const va = (a as any)[sortColumn];
        const vb = (b as any)[sortColumn];
        if (sortColumn === "emdAmt") {
          const na = parseEmdAmt(va);
          const nb = parseEmdAmt(vb);
          return sortDirection === "asc" ? na - nb : nb - na;
        }
        if (sortColumn === "issueDt" || sortColumn === "expectedRefundDateOrRefundedDate" || sortColumn === "lastEmailSentAt") {
          const da = parseDateValue(va);
          const db = parseDateValue(vb);
          if (da === db) return 0;
          return sortDirection === "asc" ? da - db : db - da;
        }
        if (va == null && vb == null) return 0;
        if (va == null) return sortDirection === "asc" ? -1 : 1;
        if (vb == null) return sortDirection === "asc" ? 1 : -1;
        return sortDirection === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }
    return result;
  }, [getFilteredRecordsExcept, sortColumn, sortDirection]);

  const totalRecords = processedRecords.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const s = (activePage - 1) * rowsPerPage;
    return processedRecords.slice(s, s + rowsPerPage);
  }, [processedRecords, activePage, rowsPerPage]);

  const handleExportExcel = useCallback(async () => {
    const exportData = processedRecords.map((rec) => {
      const obj: Record<string, string> = {};
      for (const col of CASH_COLUMNS) {
        if (col.accessor === "action") continue;
        const raw = (rec as any)[col.accessor as keyof EmdDetailsCashRecord];
        obj[col.header] = col.accessor === "lastEmailSentAt" && raw ? formatDateTimeIST(raw as string) : String(raw ?? "");
      }
      return obj;
    });
    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EMD Cash");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `EMD_CASH_${date}.xlsx`);
  }, [processedRecords]);

  const handleExportCSV = useCallback(() => {
    const exportCols = CASH_COLUMNS.filter((c) => c.accessor !== "action");
    const headers = exportCols.map((c) => c.header).join(",");
    const rows = processedRecords.map((rec) =>
      exportCols.map((col) => {
        const raw = (rec as any)[col.accessor as keyof EmdDetailsCashRecord];
        let v = col.accessor === "lastEmailSentAt" && raw ? formatDateTimeIST(raw as string) : String(raw ?? "");
        if (v.includes(",") || v.includes('"') || v.includes("\n")) v = `"${v.replace(/"/g, '""')}"`;
        return v;
      }).join(",")
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `EMD_CASH_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [processedRecords]);

  if (loading) {
    return (
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", minHeight: "500px", color: "var(--color-brand)", fontWeight: 700, flexDirection: "column", gap: "15px" }}>
        <div style={{ width: "40px", height: "40px", border: "4px solid #e1e6eb", borderTopColor: "var(--color-brand-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></div>
        <span style={{ fontSize: "16px", letterSpacing: "0.5px" }}>Loading EMD Details Cash...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "400px", gap: "12px" }}>
        <p style={{ color: "#c5221f", fontWeight: 600 }}>Failed to load EMD Details Cash: {error.message}</p>
        <button onClick={refresh} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", background: "var(--color-brand)", color: "white", borderRadius: "6px", fontWeight: 600 }}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="supply-layout-container" style={{ height: "calc(100vh - 42px)" }}>
      <aside className="supply-sidebar">
        <div className="supply-sidebar-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>EMD Cash</span>
          <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.12)", padding: "2px 6px", borderRadius: "10px" }}>{data.length} rows</span>
        </div>
        <div className="supply-sidebar-body">
          <EmdCashSidebar stats={sidebarStats} selected={selectedStatus} onSelect={setSelectedStatus} totalRows={data.length} />
        </div>
        <div className="supply-sidebar-footer">
          <button className="supply-refresh-sidebar-btn" onClick={() => { setSelectedStatus("ALL"); setGlobalSearch(""); setColumnSearchText({}); setMultiSelectFilters({}); setOpenDropdown(null); setCurrentPage(1); }}>
            <Eraser size={14} /> Clear Filter
          </button>
          <button
            className="supply-refresh-sidebar-btn"
            onClick={() => window.open("https://docs.google.com/spreadsheets/d/1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE", "_blank", "noopener,noreferrer")}
            style={{ marginTop: "8px" }}
          >
            Open Sheet
          </button>
        </div>
      </aside>

      <div className="supply-workspace">
        <header className="supply-top-header">
          <div className="supply-header-brand">
            <h1 className="supply-header-title">EMD DETAILS <span>CASH</span></h1>
            <div className="supply-header-divider" />
            <span className="supply-header-subtitle">{selectedStatus === "ALL" ? "All Statuses" : selectedStatus} — {processedRecords.length} of {data.length} records</span>
          </div>
          <div className="supply-header-actions">
            <span className="supply-record-badge" style={{ display: selectedStatus === "ALL" ? "none" : "inline-block" }}>{selectedStatus}</span>
          </div>
        </header>
        <main className="supply-body" style={{ padding: "12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="tender-table-container" style={{ flex: 1, minHeight: 0 }}>
              <div className="tender-table-toolbar">
                <div className="toolbar-left">
                  <h2 className="table-title">EMD DETAILS — CASH {selectedStatus !== "ALL" ? `(${selectedStatus})` : ""}</h2>
                  <span className="record-count-badge">{totalRecords} Records</span>
                  <div className="global-search-container">
                    <span className="search-icon" style={{ display: "inline-flex", alignItems: "center" }}><Search size={14} /></span>
                    <input type="text" className="global-search-input" placeholder="Search..." value={globalSearch} onChange={(e) => { setGlobalSearch(e.target.value); setCurrentPage(1); }} />
                  </div>
                </div>
                <div className="toolbar-right">
                  {sortColumn && (
                    <button className="export-btn" onClick={() => { setSortColumn(null); setSortDirection("desc"); }}>
                      <RotateCcw size={14} /> Clear Sort
                    </button>
                  )}
                  <button className="export-btn" onClick={handleExportCSV} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Download size={14} /> Export CSV
                  </button>
                  <button className="export-btn" onClick={handleExportExcel} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <FileSpreadsheet size={14} /> Export Excel
                  </button>
                </div>
              </div>

              <div className="tender-table-wrapper" ref={scrollContainerRef}>
                <table className="tender-data-table">
                  <thead>
                    <tr>
                      {CASH_COLUMNS.map((col) => (
                        <th
                          key={String(col.accessor)}
                          className={col.sticky ? "sticky-col" : undefined}
                          style={{
                            width: `${columnWidths[String(col.accessor)]}px`,
                            minWidth: `${columnWidths[String(col.accessor)]}px`,
                            ...(col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], zIndex: openDropdown === String(col.accessor) ? 100 : 3 } : {}),
                            ...(openDropdown === String(col.accessor) ? { zIndex: 100 } : {}),
                          }}
                        >
                          <div className="header-content" onClick={() => handleSort(col.accessor as any)} style={{ cursor: col.sortable ? "pointer" : "default" }}>
                            <span>{col.header}</span>
                            {sortColumn === col.accessor && (
                              <span className="sort-indicator" style={{ display: "inline-flex", alignItems: "center" }}>
                                {sortDirection === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </span>
                            )}
                          </div>
                          {!SKIP_FILTER_COLUMNS_CASH.has(String(col.accessor)) && (
                            <div
                              className="custom-multiselect-container"
                              ref={(el) => { dropdownRefs.current[String(col.accessor)] = el; }}
                            >
                              <button
                                className="multiselect-trigger-btn"
                                onClick={() => setOpenDropdown(openDropdown === String(col.accessor) ? null : String(col.accessor))}
                              >
                                {(!multiSelectFilters[String(col.accessor)] || multiSelectFilters[String(col.accessor)].length === 0)
                                  ? `All ${col.header}`
                                  : `${multiSelectFilters[String(col.accessor)].length} Selected`}
                                <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
                              </button>
                              {openDropdown === String(col.accessor) && (
                                <div className="multiselect-dropdown-panel">
                                  <div className="multiselect-actions">
                                    <button className="multiselect-action-btn" onClick={() => clearFilter(String(col.accessor))}>Clear All</button>
                                    <button className="multiselect-action-btn" onClick={() => selectAllFilter(String(col.accessor), uniqueValueCache[String(col.accessor)] ?? [])}>Select All</button>
                                  </div>
                                  <div className="multiselect-options-list">
                                    {(uniqueValueCache[String(col.accessor)] ?? []).map((val) => (
                                      <label key={val} className="multiselect-option-label">
                                        <input
                                          type="checkbox"
                                          checked={multiSelectFilters[String(col.accessor)]?.includes(val) ?? false}
                                          onChange={() => toggleFilter(String(col.accessor), val)}
                                        />
                                        <span title={val}>{val}</span>
                                      </label>
                                    ))}
                                    <label className="multiselect-option-label">
                                      <input
                                        type="checkbox"
                                        checked={multiSelectFilters[String(col.accessor)]?.includes("(Blank)") ?? false}
                                        onChange={() => toggleFilter(String(col.accessor), "(Blank)")}
                                      />
                                      <span>(Blank)</span>
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {String(col.accessor) !== "action" && (
                            <input
                              type="text"
                              className="column-search-input"
                              placeholder={`Search ${col.header}...`}
                              value={columnSearchText[String(col.accessor)] ?? ""}
                              onChange={(e) => { setColumnSearchText((prev) => ({ ...prev, [String(col.accessor)]: e.target.value })); setCurrentPage(1); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <div className="column-resizer" onMouseDown={(e) => handleResizeStart(e, String(col.accessor), columnWidths[String(col.accessor)])} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRecords.length === 0 ? (
                      <tr>
                        <td colSpan={CASH_COLUMNS.length} style={{ textAlign: "center", padding: "40px", color: "rgba(0,0,0,0.4)" }}>
                          No matching records found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRecords.map((row) => (
                        <tr key={String(row.id)} className="tender-row">
                          {CASH_COLUMNS.map((col) => {
                            if (col.accessor === "action") {
                              const isSending = sendingId === row.id;
                              const hasReason = !!(row as any).reason;
                              return (
                                <td key={String(col.accessor)} className="col-center" style={{ background: "#fff" }}>
                                  <button
                                    onClick={() => handleSendEmail(row)}
                                    disabled={!hasReason || isSending}
                                    title={!hasReason ? "Select Tender Conclusion Reason first" : "Send email"}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: hasReason ? "var(--color-brand)" : "#cbd5e1", color: "white", borderRadius: "6px", fontWeight: 600, fontSize: "12px", border: "none", cursor: hasReason ? "pointer" : "not-allowed", opacity: isSending ? 0.7 : 1 }}
                                  >
                                    {isSending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} {isSending ? "Sending..." : "Send Email"}
                                  </button>
                                </td>
                              );
                            }
                            if (col.accessor === "reason") {
                              const isUpdating = updatingId === row.id;
                              return (
                                <td key={String(col.accessor)} className={`${col.sticky ? "sticky-col" : ""}`} style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}>
                                  <select
                                    value={(row.reason as string) ?? ""}
                                    onChange={(e) => handleReasonChange(row.id, e.target.value)}
                                    disabled={isUpdating}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid #dadce0", fontSize: "12px", background: isUpdating ? "#f1f3f4" : "white" }}
                                  >
                                    <option value="">Select reason...</option>
                                    {TENDER_REASON_OPTIONS.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                </td>
                              );
                            }
                            if (col.accessor === "contactEmailId") {
                              const isEditing = editingContactEmailId === row.id;
                              const isUpdating = updatingContactEmailId === row.id;
                              const display = (row.contactEmailId as string) ?? "";
                              if (isEditing) {
                                return (
                                  <td key={String(col.accessor)} className={`${col.sticky ? "sticky-col" : ""}`} style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}>
                                    <div className="flex items-start gap-1" onClick={(e) => e.stopPropagation()}>
                                      <textarea
                                        autoFocus
                                        value={draftContactEmail}
                                        onChange={(e) => setDraftContactEmail(e.target.value)}
                                        placeholder="email1@company.com, email2@company.com"
                                        rows={2}
                                        style={{ flex: 1, padding: "6px 8px", borderRadius: "6px", border: `1px solid ${draftContactEmail && !isValidEmail(draftContactEmail) ? "#ef4444" : "#dadce0"}`, fontSize: "12px", resize: "vertical", minHeight: "56px" }}
                                      />
                                      <div className="flex flex-col gap-1">
                                        <button onClick={() => handleContactEmailSave(row.id)} disabled={isUpdating || (draftContactEmail.trim() !== "" && !isValidEmail(draftContactEmail))} title="Save" style={{ padding: "6px", borderRadius: "4px", background: "var(--color-brand)", color: "white", border: "none", cursor: "pointer" }}><Check size={12} /></button>
                                        <button onClick={handleContactEmailCancel} disabled={isUpdating} title="Cancel" style={{ padding: "6px", borderRadius: "4px", background: "#e5e7eb", border: "none", cursor: "pointer" }}><X size={12} /></button>
                                      </div>
                                    </div>
                                    {draftContactEmail && !isValidEmail(draftContactEmail) && <div style={{ fontSize: "10px", color: "#dc2626", marginTop: "4px" }}>Invalid: {invalidEmails(draftContactEmail).join(", ")}</div>}
                                  </td>
                                );
                              }
                              const displayVal = display;
                              const isInvalid = displayVal !== "" && !isValidEmail(displayVal);
                              return (
                                <td key={String(col.accessor)} className={`${col.sticky ? "sticky-col" : ""}`} style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}>
                                  <div
                                    onClick={(e) => { e.stopPropagation(); setEditingContactEmailId(row.id); setDraftContactEmail(displayVal); }}
                                    title={displayVal || "Click to add email"}
                                    style={{ padding: "6px 8px", borderRadius: "6px", border: isInvalid ? "1px solid #ef4444" : "1px solid transparent", background: isUpdating ? "#f1f3f4" : isInvalid ? "#fef2f2" : "transparent", cursor: "pointer", fontSize: "12px", minHeight: "28px", display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: displayVal ? (isInvalid ? "#dc2626" : undefined) : "#9ca3af" }}
                                  >
                                    {isUpdating ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                                    {displayVal || "— Add email"}
                                  </div>
                                </td>
                              );
                            }
                            if (col.accessor === "lastEmailSentAt") {
                              const v = (row as any)[col.accessor as keyof EmdDetailsCashRecord];
                              if (v == null || String(v).trim() === "") {
                                return (
                                  <td key={String(col.accessor)} className={`${col.sticky ? "sticky-col" : ""}`} style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}>
                                    <span style={{ color: "#b0b8c1" }}>-</span>
                                  </td>
                                );
                              }
                              const s = formatDateTimeIST(v as string);
                              const display = s && s.trim() !== "" ? s : "-";
                              return (
                                <td key={String(col.accessor)} className={`${col.sticky ? "sticky-col" : ""}`} style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}} title={v ? String(v) : display}>
                                  <div className="cell-scroll-wrap" style={{ height: "auto", maxHeight: "96px" }}>{display === "-" ? <span style={{ color: "#b0b8c1" }}>-</span> : display}</div>
                                </td>
                              );
                            }
                            if (col.accessor === "emailDraft") {
                              const hasDraft = Boolean((row as any).emailDraft && String((row as any).emailDraft).trim() !== "");
                              return (
                                <td
                                  key={String(col.accessor)}
                                  className={`${col.sticky ? "sticky-col" : ""}`}
                                  style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}
                                >
                                  {hasDraft ? (
                                    <button
                                      onClick={() => handleViewDraft(row)}
                                      className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-xs font-medium hover:bg-gray-50"
                                      title="View email draft"
                                    >
                                      <Eye size={12} /> View
                                    </button>
                                  ) : (
                                    <span style={{ color: "#b0b8c1" }}>-</span>
                                  )}
                                </td>
                              );
                            }
                            const raw = (row as any)[col.accessor as keyof EmdDetailsCashRecord];
                            const display = raw == null || String(raw).trim() === "" ? "-" : String(raw);
                            const alignClass = col.align === "right" ? "col-currency" : col.align === "center" ? "col-center" : "";
                            return (
                              <td
                                key={String(col.accessor)}
                                className={`${alignClass} ${col.sticky ? "sticky-col" : ""}`}
                                style={col.sticky ? { left: stickyLeftOffsets[String(col.accessor)], background: "#fff" } : {}}
                                title={display}
                              >
                                <div className="cell-scroll-wrap" style={{ height: "auto", maxHeight: "96px" }}>
                                  {display === "-" ? <span style={{ color: "#b0b8c1" }}>{display}</span> : display}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="tender-table-footer">
                <div className="footer-left">
                  <span>Rows per page:</span>
                  <select className="rows-per-page-select" value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
                <div className="footer-center">
                  {totalRecords === 0 ? "No records" : `${(activePage - 1) * rowsPerPage + 1}–${Math.min(activePage * rowsPerPage, totalRecords)} of ${totalRecords}`}
                </div>
                <div className="footer-right">
                  <button className="page-btn" disabled={activePage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Prev</button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) pageNum = i + 1;
                    else if (activePage <= 4) pageNum = i + 1;
                    else if (activePage >= totalPages - 3) pageNum = totalPages - 6 + i;
                    else pageNum = activePage - 3 + i;
                    return (
                      <button key={pageNum} className={`page-btn ${activePage === pageNum ? "active" : ""}`} onClick={() => setCurrentPage(pageNum)}>
                        {pageNum}
                      </button>
                    );
                  })}
                  <button className="page-btn" disabled={activePage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      <EmailDraftDialog open={draftOpen} onOpenChange={setDraftOpen} html={draftHtml} title={draftTitle} />
    </div>
  );
}
