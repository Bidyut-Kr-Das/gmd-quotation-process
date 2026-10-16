"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useSmartsheetTenders } from "@/hooks/useSmartsheetTenders";
import { SmartsheetTender } from "@/types/smartsheetTender";
import { ClipboardList, RefreshCw, Eraser, FileSpreadsheet, AlertTriangle, Search, ChevronUp, ChevronDown, ArrowUpDown, X, Inbox, Paperclip } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "@/app/TenderDashboard.css";

type SortField = keyof SmartsheetTender;
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortField;
  label: string;
  width: number;
}

const COLUMNS: ColDef[] = [
  { key: "enquiryDate",     label: "Enquiry Date",      width: 180 },
  { key: "partyName",       label: "Party Name",         width: 220 },
  { key: "docketNumber",    label: "Docket Number",      width: 160 },
  { key: "utility",         label: "Utility",            width: 200 },
  { key: "quotationNumber", label: "Quotation Number",   width: 170 },
  { key: "quotationDate",   label: "Quotation Date",     width: 160 },
  { key: "accountHolder",   label: "Account Holder",     width: 180 },
  { key: "tenderPurchase",      label: "Tender / Purchase",  width: 150 },
  { key: "proposedErpItemName", label: "Item Name",          width: 250 },
  { key: "proposedQty",         label: "Tender Qty",         width: 140 },
  { key: "attachmentUrl",       label: "Attachment",         width: 130 },
  { key: "priceBasis",          label: "Price Basis",        width: 130 },
  { key: "rawMaterials",        label: "Raw Materials",      width: 260 },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function cmp(a: unknown, b: unknown, dir: SortDir): number {
  const va = String(a ?? "").toLowerCase();
  const vb = String(b ?? "").toLowerCase();
  if (va < vb) return dir === "asc" ? -1 : 1;
  if (va > vb) return dir === "asc" ? 1 : -1;
  return 0;
}

/** Format raw date string "YYYY-MM-DD" → "DD-MMM-YY" for display */
function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Derive badge class from tender/purchase type value */
function purchaseBadgeClass(val: string): string {
  const v = val.toLowerCase();
  if (v.includes("tender")) return "tender";
  if (v.includes("purchase")) return "purchase";
  if (v.includes("budgetary") || v.includes("bugetary")) return "budgetary";
  if (v.includes("laser")) return "laser";
  return "purchase";
}

function parseQuantities(qtyStr: string | null): number[] {
  if (!qtyStr) return [];
  const parts = qtyStr.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
  const nums: number[] = [];
  parts.forEach(part => {
    const cleaned = part.replace(/,/g, "");
    const match = cleaned.match(/[\d.]+/);
    if (match) {
      const val = parseFloat(match[0]);
      if (!isNaN(val)) {
        nums.push(val);
      }
    }
  });
  return nums;
}

export const TenderDashboardPage: React.FC = () => {
  const { data, loading, error, refresh } = useSmartsheetTenders();

  const [search, setSearch]       = useState("");
  const [sortField, setSortField] = useState<SortField>("enquiryDate");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(50);

  // Column width states for manual expansion/resize
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    COLUMNS.forEach(col => {
      widths[col.key] = col.width;
    });
    return widths;
  });

  // Column search states (maps each column key to its search term, excluding attachmentUrl)
  const [colSearches, setColSearches] = useState<Record<string, string>>({
    enquiryDate: "",
    partyName: "",
    docketNumber: "",
    utility: "",
    quotationNumber: "",
    quotationDate: "",
    accountHolder: "",
    tenderPurchase: "",
    proposedErpItemName: "",
    proposedQty: "",
    priceBasis: "",
    rawMaterials: "",
  });

  // Specialized filters states
  const [enquiryStartDate, setEnquiryStartDate] = useState("");
  const [enquiryEndDate, setEnquiryEndDate] = useState("");
  const [quotationStartDate, setQuotationStartDate] = useState("");
  const [quotationEndDate, setQuotationEndDate] = useState("");
  const [tenderPurchaseFilter, setTenderPurchaseFilter] = useState("All");
  const [priceBasisFilter, setPriceBasisFilter] = useState("All");
  const [accountHolderFilter, setAccountHolderFilter] = useState("All");
  const [alMin, setAlMin] = useState("");
  const [alMax, setAlMax] = useState("");
  const [cuMin, setCuMin] = useState("");
  const [cuMax, setCuMax] = useState("");

  // Party Name Multi-select dropdown states
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const partyDropdownRef = useRef<HTMLDivElement>(null);

  // Item Name Multi-select dropdown states
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const itemDropdownRef = useRef<HTMLDivElement>(null);

  // Quotation Number Multi-select dropdown states
  const [showQuotationDropdown, setShowQuotationDropdown] = useState(false);
  const [selectedQuotations, setSelectedQuotations] = useState<string[]>([]);
  const quotationDropdownRef = useRef<HTMLDivElement>(null);

  // Utility Multi-select dropdown states
  const [showUtilityDropdown, setShowUtilityDropdown] = useState(false);
  const [selectedUtilities, setSelectedUtilities] = useState<string[]>([]);
  const utilityDropdownRef = useRef<HTMLDivElement>(null);

  // Tender Qty min/max states
  const [qtyMin, setQtyMin] = useState("");
  const [qtyMax, setQtyMax] = useState("");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setShowPartyDropdown(false);
      }
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(event.target as Node)) {
        setShowItemDropdown(false);
      }
      if (quotationDropdownRef.current && !quotationDropdownRef.current.contains(event.target as Node)) {
        setShowQuotationDropdown(false);
      }
      if (utilityDropdownRef.current && !utilityDropdownRef.current.contains(event.target as Node)) {
        setShowUtilityDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleColSearchChange = (key: string, val: string) => {
    setColSearches(prev => ({
      ...prev,
      [key]: val
    }));
    setPage(1);
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = colWidths[colKey];
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(60, startWidth + deltaX) // Min width of 60px
      }));
    };
    
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleClearAllFilters = () => {
    setSearch("");
    setTenderPurchaseFilter("All");
    setPriceBasisFilter("All");
    setAccountHolderFilter("All");
    setEnquiryStartDate("");
    setEnquiryEndDate("");
    setQuotationStartDate("");
    setQuotationEndDate("");
    setAlMin("");
    setAlMax("");
    setCuMin("");
    setCuMax("");
    setSelectedParties([]);
    setSelectedItems([]);
    setSelectedQuotations([]);
    setSelectedUtilities([]);
    setShowPartyDropdown(false);
    setShowItemDropdown(false);
    setShowQuotationDropdown(false);
    setShowUtilityDropdown(false);
    setQtyMin("");
    setQtyMax("");
    setColSearches({
      enquiryDate: "",
      partyName: "",
      docketNumber: "",
      utility: "",
      quotationNumber: "",
      quotationDate: "",
      accountHolder: "",
      tenderPurchase: "",
      proposedErpItemName: "",
      proposedQty: "",
      priceBasis: "",
      rawMaterials: "",
    });
    setPage(1);
  };

  // Unique purchase types for sidebar/column filters
  const purchaseTypes = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { if (r.tenderPurchase) set.add(r.tenderPurchase); });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Unique price basis options for dropdown filter
  const priceBasisOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { if (r.priceBasis) set.add(r.priceBasis); });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Unique account holders for dropdown filter
  const accountHolderOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { if (r.accountHolder) set.add(r.accountHolder.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Unique party names for dropdown filter
  const partyNamesList = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { if (r.partyName) set.add(r.partyName.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Unique item names for dropdown filter
  const itemNamesList = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => {
      if (r.proposedErpItemName) {
        r.proposedErpItemName.split(/\n+/).forEach(item => {
          const trimmed = item.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Unique quotation numbers for dropdown filter
  const quotationNumbersList = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => {
      if (r.quotationNumber) {
        const trimmed = r.quotationNumber.trim();
        if (trimmed) set.add(trimmed);
      }
    });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Filter
  const filtered = useMemo<SmartsheetTender[]>(() => {
    let rows = data;

    // 1. Sidebar Type Filter / Column Type Filter (Tender / Purchase)
    if (tenderPurchaseFilter !== "All") {
      rows = rows.filter(r => r.tenderPurchase === tenderPurchaseFilter);
    }

    // 1b. Account Holder Filter
    if (accountHolderFilter !== "All") {
      rows = rows.filter(r => (r.accountHolder ?? "").trim() === accountHolderFilter);
    }

    // 2. Global search
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(row =>
        COLUMNS.some(col => {
          if (col.key === "rawMaterials") {
            const materials = [
              { label: "al", price: row.aluminiumPrice },
              { label: "al alloy", price: row.aluminiumAlloyPrice },
              { label: "cu", price: row.copperTapePrice },
              { label: "semicon", price: row.extrudedSemiconductivePrice },
              { label: "xlpe", price: row.htXlpePrice },
              { label: "st-2", price: row.pvcTypeSt2Price },
              { label: "steel", price: row.galvanisedSteelFlatStripPrice },
              { label: "filler", price: row.fillerPrice }
            ];
            return materials.some(m => 
              m.price !== null && m.price !== undefined && m.price !== 0 &&
              (m.label.includes(q) || String(m.price).includes(q))
            );
          }
          const v = row[col.key];
          return v && String(v).toLowerCase().includes(q);
        })
      );
    }

    // 3. Individual column searches
    Object.entries(colSearches).forEach(([key, val]) => {
      const sVal = val.trim().toLowerCase();
      if (sVal) {
        rows = rows.filter(row => {
          if (key === "rawMaterials") {
            const materials = [
              { label: "al", price: row.aluminiumPrice },
              { label: "al alloy", price: row.aluminiumAlloyPrice },
              { label: "cu", price: row.copperTapePrice },
              { label: "semicon", price: row.extrudedSemiconductivePrice },
              { label: "xlpe", price: row.htXlpePrice },
              { label: "st-2", price: row.pvcTypeSt2Price },
              { label: "steel", price: row.galvanisedSteelFlatStripPrice },
              { label: "filler", price: row.fillerPrice }
            ];
            return materials.some(m => 
              m.price !== null && m.price !== undefined && m.price !== 0 &&
              (m.label.includes(sVal) || String(m.price).includes(sVal))
            );
          }
          const v = row[key as keyof SmartsheetTender];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(sVal);
        });
      }
    });

    // 3b. Specialized: Party Name Multi-select Filter
    if (selectedParties.length > 0) {
      rows = rows.filter(row => row.partyName && selectedParties.includes(row.partyName.trim()));
    }

    // 3c. Specialized: Item Name Multi-select Filter
    if (selectedItems.length > 0) {
      rows = rows.filter(row => {
        if (!row.proposedErpItemName) return false;
        const rowItems = row.proposedErpItemName.split(/\n+/).map(p => p.trim()).filter(Boolean);
        return rowItems.some(item => selectedItems.includes(item));
      });
    }

    // 3d. Specialized: Quotation Number Multi-select Filter
    if (selectedQuotations.length > 0) {
      rows = rows.filter(row => row.quotationNumber && selectedQuotations.includes(row.quotationNumber.trim()));
    }

    // 3e. Specialized: Utility Multi-select Filter
    if (selectedUtilities.length > 0) {
      rows = rows.filter(row => row.utility && selectedUtilities.includes(row.utility.trim()));
    }

    // 3f. Specialized: Tender Qty Range Filter
    if (qtyMin.trim() !== "" || qtyMax.trim() !== "") {
      rows = rows.filter(row => {
        if (!row.proposedQty) return false;
        const nums = parseQuantities(row.proposedQty);
        if (nums.length === 0) return false;
        const minVal = qtyMin.trim() !== "" ? parseFloat(qtyMin) : Number.NEGATIVE_INFINITY;
        const maxVal = qtyMax.trim() !== "" ? parseFloat(qtyMax) : Number.POSITIVE_INFINITY;
        return nums.some(n => n >= minVal && n <= maxVal);
      });
    }

    // 4. Specialized: Enquiry Date Range Filter
    if (enquiryStartDate) {
      const start = new Date(enquiryStartDate);
      rows = rows.filter(row => {
        if (!row.enquiryDate) return false;
        const d = new Date(row.enquiryDate);
        return d >= start;
      });
    }
    if (enquiryEndDate) {
      const end = new Date(enquiryEndDate);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.enquiryDate) return false;
        const d = new Date(row.enquiryDate);
        return d <= end;
      });
    }

    // 4b. Specialized: Quotation Date Range Filter
    if (quotationStartDate) {
      const start = new Date(quotationStartDate);
      rows = rows.filter(row => {
        if (!row.quotationDate) return false;
        const d = new Date(row.quotationDate);
        return d >= start;
      });
    }
    if (quotationEndDate) {
      const end = new Date(quotationEndDate);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.quotationDate) return false;
        const d = new Date(row.quotationDate);
        return d <= end;
      });
    }

    // 5. Specialized: Price Basis Filter
    if (priceBasisFilter !== "All") {
      rows = rows.filter(row => {
        const pb = row.priceBasis || "";
        return pb.toLowerCase() === priceBasisFilter.toLowerCase();
      });
    }

    // 6. Specialized: Raw Materials Aluminum & Copper Price Range Filters
    if (alMin.trim() !== "" || alMax.trim() !== "") {
      rows = rows.filter(row => {
        if (row.aluminiumPrice === null || row.aluminiumPrice === undefined) return false;
        const minVal = alMin.trim() !== "" ? parseFloat(alMin) : Number.NEGATIVE_INFINITY;
        const maxVal = alMax.trim() !== "" ? parseFloat(alMax) : Number.POSITIVE_INFINITY;
        return row.aluminiumPrice >= minVal && row.aluminiumPrice <= maxVal;
      });
    }
    if (cuMin.trim() !== "" || cuMax.trim() !== "") {
      rows = rows.filter(row => {
        if (row.copperTapePrice === null || row.copperTapePrice === undefined) return false;
        const minVal = cuMin.trim() !== "" ? parseFloat(cuMin) : Number.NEGATIVE_INFINITY;
        const maxVal = cuMax.trim() !== "" ? parseFloat(cuMax) : Number.POSITIVE_INFINITY;
        return row.copperTapePrice >= minVal && row.copperTapePrice <= maxVal;
      });
    }

    return rows;
  }, [
    data, 
    search, 
    colSearches, 
    tenderPurchaseFilter, 
    accountHolderFilter,
    selectedParties,
    selectedItems,
    selectedQuotations,
    selectedUtilities,
    qtyMin,
    qtyMax,
    enquiryStartDate, 
    enquiryEndDate, 
    quotationStartDate,
    quotationEndDate,
    priceBasisFilter, 
    alMin, 
    alMax, 
    cuMin, 
    cuMax
  ]);

  // Unique utilities for dropdown filter
  const utilitiesList = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { if (r.utility) set.add(r.utility.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [data]);

  // Sort
  const sorted = useMemo<SmartsheetTender[]>(() => {
    return [...filtered].sort((a, b) => cmp(a[sortField], b[sortField], sortDir));
  }, [filtered, sortField, sortDir]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart  = (page - 1) * pageSize;
  const paginated  = sorted.slice(pageStart, pageStart + pageSize);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  const handleRefresh = async () => { setPage(1); await refresh(); };

  const handleExportExcel = async () => {
    const exportData = sorted.map(rec => {
      const obj: Record<string, string | number> = {};
      for (const col of COLUMNS) {
        if (col.key === "rawMaterials") {
          const activeRates = [
            { label: "Al", price: rec.aluminiumPrice },
            { label: "Al Alloy", price: rec.aluminiumAlloyPrice },
            { label: "Cu", price: rec.copperTapePrice },
            { label: "Semicon", price: rec.extrudedSemiconductivePrice },
            { label: "XLPE", price: rec.htXlpePrice },
            { label: "ST-2", price: rec.pvcTypeSt2Price },
            { label: "Steel", price: rec.galvanisedSteelFlatStripPrice },
            { label: "Filler", price: rec.fillerPrice }
          ].filter(m => m.price !== null && m.price !== undefined && m.price !== 0);
          obj[col.label] = activeRates.map(m => `${m.label}: ${m.price}`).join(" | ");
        } else {
          obj[col.label] = rec[col.key] ?? "";
        }
      }
      return obj;
    });

    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Enquiry to Quotation");
    const date = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Enquiry_to_Quotation_Data_${date}.xlsx`);
  };

  const pageNumbers = (): (number | "...")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const ps: (number | "...")[] = [1];
    if (page > 3) ps.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) ps.push(i);
    if (page < totalPages - 2) ps.push("...");
    ps.push(totalPages);
    return ps;
  };

  // Sidebar stats
  const totalRecords   = data.length;
  const tenderCount    = data.filter(r => r.tenderPurchase?.toLowerCase().includes("tender")).length;
  const purchaseCount  = data.filter(r => r.tenderPurchase?.toLowerCase().includes("purchase")).length;
  const withQuotation  = data.filter(r => r.quotationNumber).length;

  return (
    <div className="tender-layout-container">
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside className="tender-sidebar">
        <div className="tender-sidebar-header" style={{ display: "flex", alignItems: "center", gap: "8px" }}><ClipboardList size={18} /> Tender Dashboard</div>
        <div className="tender-sidebar-body">

          {/* Stats */}
          <div className="tender-stat-card">
            <div className="tender-stat-label">Total Records</div>
            <div className="tender-stat-value">{totalRecords.toLocaleString()}</div>
            <div className="tender-stat-sub">from Smartsheet</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">Tenders</div>
            <div className="tender-stat-value" style={{ color: "#ff6b6b" }}>{tenderCount.toLocaleString()}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">Purchases</div>
            <div className="tender-stat-value" style={{ color: "#38ef7d" }}>{purchaseCount.toLocaleString()}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">With Quotation</div>
            <div className="tender-stat-value" style={{ color: "#69b2ff" }}>{withQuotation.toLocaleString()}</div>
          </div>

          {/* Filters */}
          <div className="tender-filter-section">
            <div className="tender-filter-label">Type Filter</div>
            <Select
              value={tenderPurchaseFilter}
              onValueChange={(v) => { setTenderPurchaseFilter(v ?? ""); setPage(1); }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {purchaseTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="tender-filter-section">
            <div className="tender-filter-label">Party Search</div>
            <input
              className="tender-filter-input"
              type="text"
              placeholder="Search party name..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="tender-sidebar-footer">
          <button
            className="tender-refresh-sidebar-btn"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? <><RefreshCw size={14} /> Loading...</> : <><RefreshCw size={14} /> Refresh Data</>}
          </button>
        </div>
      </aside>

      {/* ── Main Workspace ──────────────────────────────────────────────── */}
      <div className="tender-workspace">
        {/* Header */}
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">G M DALUI <span>TENDER</span></h1>
            <div className="tender-header-divider" />
            <span className="tender-header-subtitle">Smartsheet Dashboard</span>
          </div>
          <div className="tender-header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Eraser size={14} /> Clear Filters
            </button>
            <button className="export-excel-btn" onClick={handleExportExcel} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <FileSpreadsheet size={14} /> Export Excel
            </button>
            {/* <a
              href="http://192.168.0.230:2026/"
              target="_blank"
              rel="noopener noreferrer"
              className="ai-dashboard-btn"
            >
              <Bot size={14} /> AI Dashboard
            </a> */}
          </div>
        </header>

        {/* Body */}
        <main className="tender-body">
          {/* ── Loading ── */}
          {loading && (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <div className="smartsheet-spinner" />
                <span className="smartsheet-state-title">Fetching Smartsheet Data...</span>
                <span className="smartsheet-state-sub">Connecting to Smartsheet API and mapping columns.</span>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {!loading && error && (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <span className="smartsheet-state-icon" style={{ display: "inline-flex", alignItems: "center" }}><AlertTriangle size={24} /></span>
                <h3 className="smartsheet-error-title">Failed to Load Tender Data</h3>
                <p className="smartsheet-state-sub">{error.message}</p>
                <div className="smartsheet-error-code">{error.message}</div>
                <button className="smartsheet-retry-btn" onClick={handleRefresh}>
                  Retry Connection
                </button>
              </div>
            </div>
          )}

          {/* ── Data Table ── */}
          {!loading && !error && (
            <div className="smartsheet-table-container">
              {/* Toolbar */}
              <div className="smartsheet-toolbar">
                <div className="smartsheet-toolbar-left">
                  <p className="smartsheet-table-title">Tender Records</p>
                  <span className="smartsheet-record-badge">
                    {filtered.length.toLocaleString()} of {data.length.toLocaleString()} Records
                  </span>
                  <div className="smartsheet-search-container">
                    <span className="smartsheet-search-icon" style={{ display: "inline-flex", alignItems: "center" }}><Search size={16} /></span>
                    <input
                      id="smartsheet-global-search"
                      type="text"
                      className="smartsheet-search-input"
                      placeholder="Search all columns..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                  </div>
                </div>
              </div>
 
              {/* Table — always rendered so headers stay visible */}
              <>
                  <div className="smartsheet-table-wrapper">
                    <table className="smartsheet-data-table">
                      <thead>
                        <tr>
                          {COLUMNS.map(col => (
                            <th
                              key={col.key}
                              style={{ 
                                width: colWidths[col.key], 
                                minWidth: colWidths[col.key],
                                position: "sticky"
                              }}
                            >
                              <div className="smartsheet-th-inner" onClick={() => handleSort(col.key)}>
                                {col.label}
                                <span className="smartsheet-sort-icon">
                                  {sortField === col.key
                                    ? sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                    : <ArrowUpDown size={12} />}
                                </span>
                              </div>
                              <div className="column-filter-container" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                {col.key !== "attachmentUrl" && col.key !== "proposedQty" && (
                                  <input
                                    type="text"
                                    className="column-search-input"
                                    placeholder="Search..."
                                    value={colSearches[col.key] || ""}
                                    onChange={e => handleColSearchChange(col.key, e.target.value)}
                                  />
                                )}
                                {col.key === "utility" && (
                                  <div className="custom-multiselect-container" ref={utilityDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowUtilityDropdown(!showUtilityDropdown)}
                                      style={{ marginBottom: "4px" }}
                                    >
                                      {selectedUtilities.length === 0 ? "All Utilities" : `${selectedUtilities.length} Selected`} <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
                                    </button>
                                    {showUtilityDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedUtilities([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedUtilities(utilitiesList.filter(u => u !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {utilitiesList.filter(u => u !== "All").map(util => (
                                            <label key={util} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedUtilities.includes(util)}
                                                onChange={() => {
                                                  if (selectedUtilities.includes(util)) {
                                                    setSelectedUtilities(selectedUtilities.filter(u => u !== util));
                                                  } else {
                                                    setSelectedUtilities([...selectedUtilities, util]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{util}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "proposedQty" && (
                                  <div className="filter-row">
                                    <input
                                      type="number"
                                      placeholder="Min"
                                      className="col-price-filter-input"
                                      value={qtyMin}
                                      onChange={e => { setQtyMin(e.target.value); setPage(1); }}
                                      title="Tender Qty Min"
                                    />
                                    <span className="filter-row-dash">-</span>
                                    <input
                                      type="number"
                                      placeholder="Max"
                                      className="col-price-filter-input"
                                      value={qtyMax}
                                      onChange={e => { setQtyMax(e.target.value); setPage(1); }}
                                      title="Tender Qty Max"
                                    />
                                  </div>
                                )}
                                {col.key === "quotationNumber" && (
                                  <div className="custom-multiselect-container" ref={quotationDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowQuotationDropdown(!showQuotationDropdown)}
                                    >
                                      {selectedQuotations.length === 0 ? "All Quotations" : `${selectedQuotations.length} Selected`} <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
                                    </button>
                                    {showQuotationDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedQuotations([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedQuotations(quotationNumbersList.filter(q => q !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {quotationNumbersList.filter(q => q !== "All").map(qNum => (
                                            <label key={qNum} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedQuotations.includes(qNum)}
                                                onChange={() => {
                                                  if (selectedQuotations.includes(qNum)) {
                                                    setSelectedQuotations(selectedQuotations.filter(q => q !== qNum));
                                                  } else {
                                                    setSelectedQuotations([...selectedQuotations, qNum]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{qNum}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "partyName" && (
                                  <div className="custom-multiselect-container" ref={partyDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowPartyDropdown(!showPartyDropdown)}
                                    >
                                      {selectedParties.length === 0 ? "All Parties" : `${selectedParties.length} Selected`} <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
                                    </button>
                                    {showPartyDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedParties([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedParties(partyNamesList.filter(p => p !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {partyNamesList.filter(p => p !== "All").map(party => (
                                            <label key={party} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedParties.includes(party)}
                                                onChange={() => {
                                                  if (selectedParties.includes(party)) {
                                                    setSelectedParties(selectedParties.filter(p => p !== party));
                                                  } else {
                                                    setSelectedParties([...selectedParties, party]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{party}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "proposedErpItemName" && (
                                  <div className="custom-multiselect-container" ref={itemDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowItemDropdown(!showItemDropdown)}
                                    >
                                      {selectedItems.length === 0 ? "All Items" : `${selectedItems.length} Selected`} <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
                                    </button>
                                    {showItemDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedItems([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedItems(itemNamesList.filter(p => p !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {itemNamesList.filter(p => p !== "All").map(item => (
                                            <label key={item} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedItems.includes(item)}
                                                onChange={() => {
                                                  if (selectedItems.includes(item)) {
                                                    setSelectedItems(selectedItems.filter(i => i !== item));
                                                  } else {
                                                    setSelectedItems([...selectedItems, item]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span className="option-text" title={item}>{item}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "enquiryDate" && (
                                  <div className="column-date-filter">
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={enquiryStartDate}
                                      onChange={e => { setEnquiryStartDate(e.target.value); setPage(1); }}
                                      title="Start Date"
                                    />
                                    <span className="date-filter-to">to</span>
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={enquiryEndDate}
                                      onChange={e => { setEnquiryEndDate(e.target.value); setPage(1); }}
                                      title="End Date"
                                    />
                                    {(enquiryStartDate || enquiryEndDate) && (
                                      <button
                                        className="date-filter-clear-btn"
                                        onClick={() => {
                                          setEnquiryStartDate("");
                                          setEnquiryEndDate("");
                                          setPage(1);
                                        }}
                                        title="Clear date filter"
                                      >
                                        <X size={14} />
                                      </button>
                                    )}
                                  </div>
                                )}
                                {col.key === "quotationDate" && (
                                  <div className="column-date-filter">
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={quotationStartDate}
                                      onChange={e => { setQuotationStartDate(e.target.value); setPage(1); }}
                                      title="Start Date"
                                    />
                                    <span className="date-filter-to">to</span>
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={quotationEndDate}
                                      onChange={e => { setQuotationEndDate(e.target.value); setPage(1); }}
                                      title="End Date"
                                    />
                                    {(quotationStartDate || quotationEndDate) && (
                                      <button
                                        className="date-filter-clear-btn"
                                        onClick={() => {
                                          setQuotationStartDate("");
                                          setQuotationEndDate("");
                                          setPage(1);
                                        }}
                                        title="Clear date filter"
                                      >
                                        <X size={14} />
                                      </button>
                                    )}
                                  </div>
                                )}
                                {col.key === "tenderPurchase" && (
                                  <Select
                                    value={tenderPurchaseFilter}
                                    onValueChange={(v) => { setTenderPurchaseFilter(v ?? ""); setPage(1); }}
                                  >
                                    <SelectTrigger size="sm" className="price-basis-filter-select w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {purchaseTypes.map(t => (
                                        <SelectItem key={t} value={t}>
                                          {t}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {col.key === "accountHolder" && (
                                  <Select
                                    value={accountHolderFilter}
                                    onValueChange={(v) => { setAccountHolderFilter(v ?? ""); setPage(1); }}
                                  >
                                    <SelectTrigger size="sm" className="price-basis-filter-select w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {accountHolderOptions.map(t => (
                                        <SelectItem key={t} value={t}>
                                          {t}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {col.key === "priceBasis" && (
                                  <Select
                                    value={priceBasisFilter}
                                    onValueChange={(v) => { setPriceBasisFilter(v ?? ""); setPage(1); }}
                                  >
                                    <SelectTrigger size="sm" className="price-basis-filter-select w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {priceBasisOptions.map(t => (
                                        <SelectItem key={t} value={t}>
                                          {t}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {col.key === "rawMaterials" && (
                                  <div className="column-raw-materials-filter">
                                    <div className="filter-row">
                                      <span className="filter-row-label">Al:</span>
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        className="col-price-filter-input"
                                        value={alMin}
                                        onChange={e => { setAlMin(e.target.value); setPage(1); }}
                                        title="Aluminium Min"
                                      />
                                      <span className="filter-row-dash">-</span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        className="col-price-filter-input"
                                        value={alMax}
                                        onChange={e => { setAlMax(e.target.value); setPage(1); }}
                                        title="Aluminium Max"
                                      />
                                    </div>
                                    <div className="filter-row" style={{ marginTop: "4px" }}>
                                      <span className="filter-row-label">Cu:</span>
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        className="col-price-filter-input"
                                        value={cuMin}
                                        onChange={e => { setCuMin(e.target.value); setPage(1); }}
                                        title="Copper Min"
                                      />
                                      <span className="filter-row-dash">-</span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        className="col-price-filter-input"
                                        value={cuMax}
                                        onChange={e => { setCuMax(e.target.value); setPage(1); }}
                                        title="Copper Max"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div
                                className="col-resize-handle"
                                onMouseDown={e => handleResizeStart(e, col.key)}
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.length === 0 ? (
                          <tr>
                            <td
                              colSpan={COLUMNS.length}
                              style={{
                                textAlign: "center",
                                padding: "48px 20px",
                                color: "rgba(0,0,0,0.4)",
                                fontSize: "13px",
                                fontWeight: 500,
                              }}
                            >
                              <Inbox size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} /> No matching records found. Try adjusting your filters.
                            </td>
                          </tr>
                        ) : paginated.map((row, idx) => (
                          <tr key={pageStart + idx} className="smartsheet-row">
                            {/* Enquiry Date */}
                            <td>
                              {row.enquiryDate
                                ? <span className="enquiry-date-badge">{formatDate(row.enquiryDate)}</span>
                                : <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Party Name */}
                            <td title={row.partyName ?? undefined}>
                              {row.partyName ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Docket Number */}
                            <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--color-brand)" }}>
                              {row.docketNumber ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Utility */}
                            <td title={row.utility ?? undefined}>
                              {row.utility ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Quotation Number */}
                            <td style={{ fontFamily: "monospace" }}>
                              {row.quotationNumber ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Quotation Date */}
                            <td>
                              {row.quotationDate ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Account Holder */}
                            <td>
                              {row.accountHolder ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Tender Purchase */}
                            <td>
                              {row.tenderPurchase
                                ? <span className={`purchase-type-badge ${purchaseBadgeClass(row.tenderPurchase)}`}>
                                    {row.tenderPurchase}
                                  </span>
                                : <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Item Name */}
                            <td className="col-item-name text-pre-line" title={row.proposedErpItemName ?? undefined}>
                              {(() => {
                                if (!row.proposedErpItemName) return <span className="smartsheet-null-cell">—</span>;
                                const parts = row.proposedErpItemName.split(/\n+/).map(p => p.trim()).filter(Boolean);
                                if (parts.length > 1) {
                                  return (
                                    <div className="tender-item-stack" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                      {parts.map((part, pIdx) => (
                                        <span className="tender-item-name-tag" key={pIdx} style={{ display: "inline-block", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return row.proposedErpItemName;
                              })()}
                            </td>
                            {/* Tender Qty */}
                            <td className="col-tender-qty text-pre-line">
                              {(() => {
                                if (!row.proposedQty) return <span className="smartsheet-null-cell">—</span>;
                                const parts = row.proposedQty.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
                                if (parts.length > 1) {
                                  return (
                                    <div className="tender-qty-stack" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                      {parts.map((part, pIdx) => (
                                        <span className="tender-qty-item" key={pIdx} style={{ display: "inline-block", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return row.proposedQty;
                              })()}
                            </td>
                            {/* Attachment */}
                            <td style={{ textAlign: "center" }}>
                              {row.attachmentUrl ? (
                                <button
                                  className="table-attachment-btn"
                                  onClick={() => {
                                    window.open(row.attachmentUrl!, "_blank");
                                  }}
                                  title="View Costing Sheet"
                                  style={{ padding: "4px 8px", background: "var(--color-brand-light)", color: "var(--color-brand-accent)", border: "1px solid var(--color-brand-light)", borderRadius: "4px", fontSize: "11px", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                                >
                                  <Paperclip size={14} /> Costing
                                </button>
                              ) : (
                                <span className="smartsheet-null-cell">—</span>
                              )}
                            </td>
                            {/* Price Basis */}
                            <td style={{ textAlign: "center" }}>
                              {row.priceBasis ? (
                                <span className="purchase-type-badge purchase" style={{ textTransform: "capitalize" }}>
                                  {row.priceBasis}
                                </span>
                              ) : (
                                <span className="smartsheet-null-cell">—</span>
                              )}
                            </td>
                            {/* Raw Materials */}
                            <td>
                              {(() => {
                                const activeRates = [
                                  { label: "Al", price: row.aluminiumPrice },
                                  { label: "Al Alloy", price: row.aluminiumAlloyPrice },
                                  { label: "Cu", price: row.copperTapePrice },
                                  { label: "Semicon", price: row.extrudedSemiconductivePrice },
                                  { label: "XLPE", price: row.htXlpePrice },
                                  { label: "ST-2", price: row.pvcTypeSt2Price },
                                  { label: "Steel", price: row.galvanisedSteelFlatStripPrice },
                                  { label: "Filler", price: row.fillerPrice }
                                ].filter(m => m.price !== null && m.price !== undefined && m.price !== 0);

                                return activeRates.length > 0 ? (
                                  <div className="raw-materials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2px", fontSize: "10px" }}>
                                    {activeRates.map(m => (
                                      <div className="material-rate-tag" key={m.label} title={`${m.label}: ₹${m.price}/kg`} style={{ background: "#f1f3f4", padding: "2px 4px", borderRadius: "3px", border: "1px solid #dadce0" }}>
                                        <span className="mat-lbl" style={{ fontWeight: 600, color: "#5f6368" }}>{m.label}:</span>
                                        <span className="mat-val" style={{ marginLeft: "2px", color: "#202124" }}>₹{m.price}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="smartsheet-null-cell">—</span>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <div className="smartsheet-table-footer">
                    <div className="smartsheet-footer-left">
                      <span>Rows per page:</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => { setPageSize(Number(v ?? pageSize)); setPage(1); }}
                      >
                        <SelectTrigger size="sm" className="smartsheet-rows-select h-7 w-auto text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="smartsheet-footer-center">
                      {pageStart + 1}–{Math.min(pageStart + pageSize, sorted.length)} of {sorted.length}
                    </div>
                    <div className="smartsheet-pagination">
                      <button className="smartsheet-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                      {pageNumbers().map((p, i) =>
                        p === "..." ? (
                          <span key={`e${i}`} style={{ padding: "0 4px", color: "#5f6368", fontSize: 12 }}>…</span>
                        ) : (
                          <button key={p} className={`smartsheet-page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p as number)}>{p}</button>
                        )
                      )}
                      <button className="smartsheet-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                    </div>
                  </div>
                </>
            </div>
          )}
        </main>

        {/* Footer status bar */}
        <footer className="tender-status-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#137333" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#34a853", display: "inline-block", animation: "blink 1.5s infinite" }} />
              <span>SMARTSHEET LIVE</span>
            </div>
          </div>
          <div style={{ color: "var(--color-brand)", textTransform: "uppercase", fontWeight: 700 }}>
            G M DALUI TENDER SMARTSHEET PIPELINE
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ backgroundColor: "#e1e6eb", color: "var(--color-brand)", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
              G M DALUI ERP V2.1 PRO
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TenderDashboardPage;
