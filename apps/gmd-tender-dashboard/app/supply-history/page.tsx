"use client";
import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useSupplyHistory } from "@/hooks/useSupplyHistory";
import { SupplyHistoryRecord } from "@/types/supplyHistory";
import { SupplyAttachmentModal } from "@/components/SupplyAttachmentModal";
// import { Package, RefreshCw, Eraser, ExternalLink, FileSpreadsheet, AlertTriangle, Search, ChevronUp, ChevronDown, ArrowUpDown, X, Inbox, FolderOpen } from "lucide-react";
import { Package, RefreshCw, Eraser, FileSpreadsheet, AlertTriangle, Search, ChevronUp, ChevronDown, ArrowUpDown, X, Inbox, FolderOpen, FileText, ExternalLink, Download, Pencil, Check, Mail, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "@/app/SupplyHistory.css";

type SortField = keyof SupplyHistoryRecord;
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortField;
  label: string;
  width: number;
  align: "left" | "center" | "right";
}

const COLUMNS: ColDef[] = [
  { key: "fy",              label: "FY",                width: 80,  align: "center" },
  { key: "saleBillNumber",  label: "Sale Bill No",      width: 140, align: "left"   },
  { key: "saleBillDate",    label: "Sale Bill Date",    width: 150, align: "center" },
  { key: "partyName",       label: "Party Name",        width: 200, align: "left"   },
  { key: "itemCode",        label: "Item Code",         width: 120, align: "left"   },
  { key: "itemSchedule",    label: "Item Schedule",     width: 180, align: "left"   },
  { key: "itemName",        label: "Item Name",         width: 220, align: "left"   },
  { key: "lrNo",            label: "LR No",             width: 140, align: "left"   },
  { key: "partyRefNo",      label: "Party Ref No",      width: 140, align: "left"   },
  { key: "partyRefDate",    label: "Party Ref Date",    width: 150, align: "center" },
  { key: "contractVrNo",    label: "Contract VR No",    width: 140, align: "left"   },
  { key: "quotationNo",     label: "Quotation No",      width: 120, align: "left"   },
  { key: "docketNo",        label: "Docket No",         width: 140, align: "left"   },
  { key: "utility",         label: "Utility",           width: 220, align: "left"   },
  { key: "rate",            label: "Rate",              width: 110, align: "right"  },
  { key: "invoiceQty",      label: "Invoice Qty",       width: 110, align: "right"  },
  { key: "invoiceAmt",      label: "Invoice Amt",       width: 130, align: "right"  },
  { key: "email",               label: "Email",                 width: 200, align: "left"   },
  { key: "contactNo",           label: "Contact No",            width: 150, align: "left"   },
  { key: "hasDocuments",        label: "Documents",             width: 140, align: "center" },
  { key: "certificateSentDate", label: "Certificate Sent Date", width: 160, align: "center" },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function cmp(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
  dir: SortDir
): number {
  const va = a ?? "";
  const vb = b ?? "";
  if (va < vb) return dir === "asc" ? -1 : 1;
  if (va > vb) return dir === "asc" ? 1 : -1;
  return 0;
}

function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function formatNumber(val: number | null): string {
  if (val === null || val === undefined) return "";
  return val.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

interface ColumnMultiselectDropdownProps {
  triggerLabel: string;
  selected: string[];
  options: string[];
  show: boolean;
  onToggleShow: () => void;
  onToggleOption: (value: string) => void;
  onClearAll: () => void;
  onSelectAll: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const ColumnMultiselectDropdown: React.FC<ColumnMultiselectDropdownProps> = ({
  triggerLabel,
  selected,
  options,
  show,
  onToggleShow,
  onToggleOption,
  onClearAll,
  onSelectAll,
  containerRef,
}) => {
  const [optSearch, setOptSearch] = useState("");
  const filteredOptions = useMemo(() => {
    const q = optSearch.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, optSearch]);
  useEffect(() => {
    if (!show) setOptSearch("");
  }, [show]);
  return (
    <div className="custom-multiselect-container" ref={containerRef}>
      <button
        className="multiselect-trigger-btn"
        onClick={onToggleShow}
        style={{ marginBottom: "4px" }}
      >
        {selected.length === 0 ? triggerLabel : `${selected.length} Selected`} <span className="dropdown-arrow" style={{ display: "inline-flex", alignItems: "center" }}><ChevronDown size={12} /></span>
      </button>
      {show && (
        <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
          <div className="multiselect-search-wrap">
            <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }} />
            <input
              type="text"
              className="multiselect-search-input"
              placeholder="Search options..."
              value={optSearch}
              onChange={e => setOptSearch(e.target.value)}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
            {optSearch && (
              <button
                className="multiselect-search-clear"
                onClick={e => { e.stopPropagation(); setOptSearch(""); }}
                title="Clear"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="multiselect-actions">
            <button className="multiselect-action-btn" onClick={onClearAll}>Clear All</button>
            <button className="multiselect-action-btn" onClick={onSelectAll}>Select All</button>
          </div>
          <div className="multiselect-options-list">
            {filteredOptions.length === 0 ? (
              <span className="multiselect-no-options">No matching options</span>
            ) : filteredOptions.map(option => (
              <label key={option} className="multiselect-option-label">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => onToggleOption(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SupplyHistoryDashboard: React.FC = () => {
  const { data, loading, error, refresh } = useSupplyHistory();

  const [search, setSearch]       = useState("");
  const [sortField, setSortField] = useState<SortField>("saleBillDate");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(50);

  const [colSearches, setColSearches] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    COLUMNS.forEach(c => { map[c.key] = ""; });
    return map;
  });

  const [saleBillDateStart, setSaleBillDateStart] = useState("");
  const [saleBillDateEnd, setSaleBillDateEnd] = useState("");
  const [partyRefDateStart, setPartyRefDateStart] = useState("");
  const [partyRefDateEnd, setPartyRefDateEnd] = useState("");
  const [certSentDateStart, setCertSentDateStart] = useState("");
  const [certSentDateEnd, setCertSentDateEnd] = useState("");
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const partyDropdownRef = useRef<HTMLDivElement>(null);

  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const itemDropdownRef = useRef<HTMLDivElement>(null);

  const [showPartyRefDropdown, setShowPartyRefDropdown] = useState(false);
  const [selectedPartyRefs, setSelectedPartyRefs] = useState<string[]>([]);
  const partyRefDropdownRef = useRef<HTMLDivElement>(null);

  const [showContractDropdown, setShowContractDropdown] = useState(false);
  const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
  const contractDropdownRef = useRef<HTMLDivElement>(null);

  const [showQuotationDropdown, setShowQuotationDropdown] = useState(false);
  const [selectedQuotations, setSelectedQuotations] = useState<string[]>([]);
  const quotationDropdownRef = useRef<HTMLDivElement>(null);

  const [showDocketDropdown, setShowDocketDropdown] = useState(false);
  const [selectedDockets, setSelectedDockets] = useState<string[]>([]);
  const docketDropdownRef = useRef<HTMLDivElement>(null);

  const [showUtilityDropdown, setShowUtilityDropdown] = useState(false);
  const [selectedUtilities, setSelectedUtilities] = useState<string[]>([]);
  const utilityDropdownRef = useRef<HTMLDivElement>(null);

  const [showFyDropdown, setShowFyDropdown] = useState(false);
  const [selectedFy, setSelectedFy] = useState<string[]>([]);
  const fyDropdownRef = useRef<HTMLDivElement>(null);

  const [showBillNoDropdown, setShowBillNoDropdown] = useState(false);
  const [selectedBillNos, setSelectedBillNos] = useState<string[]>([]);
  const billNoDropdownRef = useRef<HTMLDivElement>(null);

  const [showItemCodeDropdown, setShowItemCodeDropdown] = useState(false);
  const [selectedItemCodes, setSelectedItemCodes] = useState<string[]>([]);
  const itemCodeDropdownRef = useRef<HTMLDivElement>(null);

  const [showLrNoDropdown, setShowLrNoDropdown] = useState(false);
  const [selectedLrNos, setSelectedLrNos] = useState<string[]>([]);
  const lrNoDropdownRef = useRef<HTMLDivElement>(null);

  const [showDocsDropdown, setShowDocsDropdown] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const docsDropdownRef = useRef<HTMLDivElement>(null);

  const [showItemScheduleDropdown, setShowItemScheduleDropdown] = useState(false);
  const [selectedItemSchedules, setSelectedItemSchedules] = useState<string[]>([]);
  const itemScheduleDropdownRef = useRef<HTMLDivElement>(null);

  const [showEmailDropdown, setShowEmailDropdown] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const emailDropdownRef = useRef<HTMLDivElement>(null);

  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const contactDropdownRef = useRef<HTMLDivElement>(null);

  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [qtyMin, setQtyMin] = useState("");
  const [qtyMax, setQtyMax] = useState("");
  const [amtMin, setAmtMin] = useState("");
  const [amtMax, setAmtMax] = useState("");
  const [selectedBillNo, setSelectedBillNo] = useState<string | null>(null);
  const [selectedAttachmentUrl, setSelectedAttachmentUrl] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [syncingQuotation, setSyncingQuotation] = useState(false);
  const [downloadingDocs, setDownloadingDocs] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  // Inline editing for Email / Contact No / Item Schedule
  const [editingCell, setEditingCell] = useState<{ saleBillNumber: string; itemCode: string; field: "email" | "contactNo" | "itemSchedule" } | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [localData, setLocalData] = useState<SupplyHistoryRecord[] | null>(null);
  const displayData = localData ?? data;

  type CertState =
    | { status: "idle" }
    | { status: "generating" }
    | { status: "ready"; driveUrl: string; fileName: string }
    | { status: "emailSending" }
    | { status: "emailSent" }
    | { status: "error"; error: string };

  const [certStates, setCertStates] = useState<Record<string, CertState>>({});
  const certGeneratingRef = useRef<Set<string>>(new Set());
  const emailSendingRef = useRef<Set<string>>(new Set());

  const triggerDownload = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleGenerateCertificate = useCallback(
    async (partyRefNo: string) => {
      if (certGeneratingRef.current.has(partyRefNo)) return;
      certGeneratingRef.current.add(partyRefNo);

      setCertStates((prev) => ({ ...prev, [partyRefNo]: { status: "generating" } }));

      const group = displayData.filter((r) => r.partyRefNo === partyRefNo);
      const fallbackFileName = `Certificate_${partyRefNo || "NAN"}.pdf`;

      try {
        const res = await fetch("/api/supply-history/generate-certificate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: group }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Generation failed" }));
          throw new Error(err.error || "Generation failed");
        }
        const driveUrl = res.headers.get("X-Drive-Url") || "";
        const contentDisp = res.headers.get("Content-Disposition") || "";
        const match = contentDisp.match(/filename="?([^"]+)"?/);
        const fileName = match ? match[1] : fallbackFileName;
        const blob = await res.blob();
        triggerDownload(blob, fileName);
        // Persist locally and optimistically update displayData certificateUrl (no full-page refresh)
        setCertStates((prev) => ({ ...prev, [partyRefNo]: { status: "ready", driveUrl, fileName } }));
        const updatedRows = group.map((r) => r.certificateUrl ? r : { ...r, certificateUrl: driveUrl, certificateFileName: fileName });
        if (updatedRows.some((r) => r.certificateUrl)) {
          setLocalData((prev) => {
            const base = prev ?? displayData;
            return base.map((r) => (r.partyRefNo === partyRefNo ? { ...r, certificateUrl: driveUrl, certificateFileName: fileName } : r));
          });
        }
        toast.success("Certificate generated successfully");
      } catch (err: any) {
        setCertStates((prev) => ({
          ...prev,
          [partyRefNo]: { status: "error", error: err.message },
        }));
        toast.error(err.message || "Failed to generate certificate");
      } finally {
        certGeneratingRef.current.delete(partyRefNo);
      }
    },
    [displayData, triggerDownload]
  );

  const handleSendCertificateEmail = useCallback(
    async (partyRefNo: string) => {
      if (emailSendingRef.current.has(partyRefNo)) return;
      emailSendingRef.current.add(partyRefNo);
      setCertStates((prev) => ({ ...prev, [partyRefNo]: { status: "emailSending" } }));
      try {
        const res = await fetch("/api/supply-history/send-certificate-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partyRefNo }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Failed to send email");
        }
        setCertStates((prev) => ({ ...prev, [partyRefNo]: { status: "emailSent" } }));
        toast.success(`Certificate emailed to ${json.to}${json.cc?.length ? ` (cc: ${json.cc.join(", ")})` : ""}`);
        // Optimistically update certificateSentDate for all rows sharing partyRefNo
        const sentIso: string = json.certificateSentDate ?? new Date().toISOString();
        setLocalData((prev) => {
          const base = prev ?? displayData;
          return base.map((r) => (r.partyRefNo === partyRefNo ? { ...r, certificateSentDate: sentIso } : r));
        });
        // Reset to ready after 3s
        setTimeout(() => {
          setCertStates((prev) => {
            const state = prev[partyRefNo];
            if (state?.status === "emailSent") {
              const row = displayData.find((r) => r.partyRefNo === partyRefNo);
              const driveUrl = (row as any)?.certificateUrl || "";
              const fileName = (row as any)?.certificateFileName || `Certificate_${partyRefNo}.pdf`;
              return { ...prev, [partyRefNo]: { status: "ready", driveUrl, fileName } };
            }
            return prev;
          });
        }, 3000);
      } catch (err: any) {
        setCertStates((prev) => ({
          ...prev,
          [partyRefNo]: { status: "error", error: err.message },
        }));
        toast.error(err.message || "Failed to send email");
      } finally {
        emailSendingRef.current.delete(partyRefNo);
      }
    },
    [displayData],
  );

  // Keep localData in sync when server data refreshes (unless editing)
  useEffect(() => {
    if (localData) setLocalData(null);
  }, [data]);

  const handleEditStart = useCallback((row: SupplyHistoryRecord, field: "email" | "contactNo" | "itemSchedule") => {
    setEditingCell({ saleBillNumber: row.saleBillNumber ?? "", itemCode: row.itemCode ?? "", field });
    setEditingDraft(String((row as any)[field] ?? ""));
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingCell(null);
    setEditingDraft("");
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingCell) return;
    const { saleBillNumber, itemCode, field } = editingCell;
    const key = `${saleBillNumber}|${itemCode}|${field}`;
    const value = editingDraft.trim();
    // Validation — allow comma/semicolon separated list (to/cc)
    if (field === "email" && value) {
      const parts = value
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set<string>();
      for (const p of parts) {
        if (!re.test(p)) {
          toast.error(`Invalid email: ${p}`);
          return;
        }
        const lower = p.toLowerCase();
        if (seen.has(lower)) {
          toast.error(`Duplicate email: ${p}`);
          return;
        }
        seen.add(lower);
      }
      if (value.length > 1000) {
        toast.error("Too many emails (max 1000 chars)");
        return;
      }
    }
    if (field === "contactNo" && value) {
      const re = /^[0-9+\-()\s]+$/;
      if (!re.test(value)) { toast.error("Contact number may only contain digits, +, -, (), spaces"); return; }
      const digits = value.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) { toast.error("Contact number must be 7-15 digits"); return; }
    }
    setSavingCells(prev => new Set(prev).add(key));
    try {
      const res = await fetch("/api/supply-history/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleBillNumber, itemCode, field, value }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Update failed");
      // Optimistic local update
      const updatedRow = json.data;
      setLocalData(prev => {
        const base = prev ?? data;
        return base.map(r => (r.saleBillNumber === saleBillNumber && r.itemCode === itemCode ? { ...r, [field]: updatedRow[field] ?? value } : r));
      });
      toast.success(`${field} updated successfully!`);
      setEditingCell(null);
      setEditingDraft("");
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSavingCells(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [editingCell, editingDraft, data]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    COLUMNS.forEach(c => { initial[c.key] = c.width; });
    return initial;
  });

  const resizingColumnRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const handleResizeStart = (e: React.MouseEvent, accessor: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumnRef.current = accessor;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "col-resize";
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingColumnRef.current) return;
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(50, startWidthRef.current + diff);
    setColumnWidths(prev => ({ ...prev, [resizingColumnRef.current!]: newWidth }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "";
    resizingColumnRef.current = null;
  }, [handleResizeMove]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setShowPartyDropdown(false);
      }
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(event.target as Node)) {
        setShowItemDropdown(false);
      }
      if (partyRefDropdownRef.current && !partyRefDropdownRef.current.contains(event.target as Node)) {
        setShowPartyRefDropdown(false);
      }
      if (contractDropdownRef.current && !contractDropdownRef.current.contains(event.target as Node)) {
        setShowContractDropdown(false);
      }
      if (quotationDropdownRef.current && !quotationDropdownRef.current.contains(event.target as Node)) {
        setShowQuotationDropdown(false);
      }
      if (docketDropdownRef.current && !docketDropdownRef.current.contains(event.target as Node)) {
        setShowDocketDropdown(false);
      }
      if (utilityDropdownRef.current && !utilityDropdownRef.current.contains(event.target as Node)) {
        setShowUtilityDropdown(false);
      }
      if (fyDropdownRef.current && !fyDropdownRef.current.contains(event.target as Node)) {
        setShowFyDropdown(false);
      }
      if (billNoDropdownRef.current && !billNoDropdownRef.current.contains(event.target as Node)) {
        setShowBillNoDropdown(false);
      }
      if (itemCodeDropdownRef.current && !itemCodeDropdownRef.current.contains(event.target as Node)) {
        setShowItemCodeDropdown(false);
      }
      if (lrNoDropdownRef.current && !lrNoDropdownRef.current.contains(event.target as Node)) {
        setShowLrNoDropdown(false);
      }
      if (docsDropdownRef.current && !docsDropdownRef.current.contains(event.target as Node)) {
        setShowDocsDropdown(false);
      }
      if (itemScheduleDropdownRef.current && !itemScheduleDropdownRef.current.contains(event.target as Node)) {
        setShowItemScheduleDropdown(false);
      }
      if (emailDropdownRef.current && !emailDropdownRef.current.contains(event.target as Node)) {
        setShowEmailDropdown(false);
      }
      if (contactDropdownRef.current && !contactDropdownRef.current.contains(event.target as Node)) {
        setShowContactDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [handleResizeMove, handleResizeEnd]);

  const handleColSearchChange = (key: string, val: string) => {
    setColSearches(prev => ({ ...prev, [key]: val }));
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setSearch("");
    setSaleBillDateStart("");
    setSaleBillDateEnd("");
    setPartyRefDateStart("");
    setPartyRefDateEnd("");
    setCertSentDateStart("");
    setCertSentDateEnd("");
    setRateMin("");
    setRateMax("");
    setQtyMin("");
    setQtyMax("");
    setAmtMin("");
    setAmtMax("");
    setSelectedParties([]);
    setShowPartyDropdown(false);
    setSelectedItems([]);
    setShowItemDropdown(false);
    setSelectedPartyRefs([]);
    setShowPartyRefDropdown(false);
    setSelectedContracts([]);
    setShowContractDropdown(false);
    setSelectedQuotations([]);
    setShowQuotationDropdown(false);
    setSelectedDockets([]);
    setShowDocketDropdown(false);
    setSelectedUtilities([]);
    setShowUtilityDropdown(false);
    setSelectedFy([]);
    setShowFyDropdown(false);
    setSelectedBillNos([]);
    setShowBillNoDropdown(false);
    setSelectedItemCodes([]);
    setShowItemCodeDropdown(false);
    setSelectedLrNos([]);
    setShowLrNoDropdown(false);
    setSelectedDocs([]);
    setShowDocsDropdown(false);
    setSelectedItemSchedules([]);
    setShowItemScheduleDropdown(false);
    setSelectedEmails([]);
    setShowEmailDropdown(false);
    setSelectedContacts([]);
    setShowContactDropdown(false);
    const cleared: Record<string, string> = {};
    COLUMNS.forEach(c => { cleared[c.key] = ""; });
    setColSearches(cleared);
    setPage(1);
  };

  const filtered = useMemo<SupplyHistoryRecord[]>(() => {
    let rows = displayData;

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(row =>
        COLUMNS.some(col => {
          const v = row[col.key];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
        })
      );
    }

    Object.entries(colSearches).forEach(([key, val]) => {
      const sVal = val.trim().toLowerCase();
      if (sVal) {
        rows = rows.filter(row => {
          const v = row[key as keyof SupplyHistoryRecord];
          if (v === null || v === undefined) return false;
          if (key === "hasDocuments") {
            const label = v ? "yes" : "no";
            return label.includes(sVal) || String(v).toLowerCase().includes(sVal);
          }
          if (typeof v === "number") {
            const numStr = String(v).toLowerCase();
            const fmt = formatNumber(v).toLowerCase();
            return numStr.includes(sVal) || fmt.includes(sVal);
          }
          if ((key === "saleBillDate" || key === "partyRefDate" || key === "certificateSentDate") && typeof v === "string") {
            const fmt = formatDate(v);
            return String(v).toLowerCase().includes(sVal) || Boolean(fmt && fmt.toLowerCase().includes(sVal));
          }
          return String(v).toLowerCase().includes(sVal);
        });
      }
    });

    if (selectedParties.length > 0) {
      rows = rows.filter(row => row.partyName && selectedParties.includes(row.partyName.trim()));
    }

    if (selectedItems.length > 0) {
      rows = rows.filter(row => row.itemName && selectedItems.includes(row.itemName.trim()));
    }

    if (selectedPartyRefs.length > 0) {
      rows = rows.filter(row => row.partyRefNo && selectedPartyRefs.includes(row.partyRefNo.trim()));
    }

    if (selectedContracts.length > 0) {
      rows = rows.filter(row => row.contractVrNo && selectedContracts.includes(row.contractVrNo.trim()));
    }

    if (selectedQuotations.length > 0) {
      rows = rows.filter(row => row.quotationNo && selectedQuotations.includes(row.quotationNo.trim()));
    }

    if (selectedDockets.length > 0) {
      rows = rows.filter(row => row.docketNo && selectedDockets.includes(row.docketNo.trim()));
    }

    if (selectedUtilities.length > 0) {
      rows = rows.filter(row => row.utility && selectedUtilities.includes(row.utility.trim()));
    }

    if (selectedFy.length > 0) {
      rows = rows.filter(row => row.fy && selectedFy.includes(row.fy.trim()));
    }

    if (selectedBillNos.length > 0) {
      rows = rows.filter(row => row.saleBillNumber && selectedBillNos.includes(row.saleBillNumber.trim()));
    }

    if (selectedItemCodes.length > 0) {
      rows = rows.filter(row => row.itemCode && selectedItemCodes.includes(row.itemCode.trim()));
    }

    if (selectedLrNos.length > 0) {
      rows = rows.filter(row => row.lrNo && selectedLrNos.includes(row.lrNo.trim()));
    }

    if (selectedDocs.length > 0) {
      rows = rows.filter(row => selectedDocs.includes(row.hasDocuments ? "Yes" : "No"));
    }

    if (selectedItemSchedules.length > 0) {
      rows = rows.filter(row => row.itemSchedule && selectedItemSchedules.includes(row.itemSchedule.trim()));
    }

    if (selectedEmails.length > 0) {
      rows = rows.filter(row => row.email && selectedEmails.includes(row.email.trim()));
    }

    if (selectedContacts.length > 0) {
      rows = rows.filter(row => row.contactNo && selectedContacts.includes(row.contactNo.trim()));
    }

    if (saleBillDateStart) {
      const start = new Date(saleBillDateStart);
      rows = rows.filter(row => {
        if (!row.saleBillDate) return false;
        return new Date(row.saleBillDate) >= start;
      });
    }
    if (saleBillDateEnd) {
      const end = new Date(saleBillDateEnd);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.saleBillDate) return false;
        return new Date(row.saleBillDate) <= end;
      });
    }

    if (partyRefDateStart) {
      const start = new Date(partyRefDateStart);
      rows = rows.filter(row => {
        if (!row.partyRefDate) return false;
        return new Date(row.partyRefDate) >= start;
      });
    }
    if (partyRefDateEnd) {
      const end = new Date(partyRefDateEnd);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.partyRefDate) return false;
        return new Date(row.partyRefDate) <= end;
      });
    }

    if (certSentDateStart) {
      const start = new Date(certSentDateStart);
      rows = rows.filter(row => {
        if (!row.certificateSentDate) return false;
        return new Date(row.certificateSentDate) >= start;
      });
    }
    if (certSentDateEnd) {
      const end = new Date(certSentDateEnd);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.certificateSentDate) return false;
        return new Date(row.certificateSentDate) <= end;
      });
    }

    const rateLo = rateMin.trim() !== "" ? parseFloat(rateMin) : Number.NEGATIVE_INFINITY;
    const rateHi = rateMax.trim() !== "" ? parseFloat(rateMax) : Number.POSITIVE_INFINITY;
    if (isFinite(rateLo) || isFinite(rateHi)) {
      rows = rows.filter(row => row.rate !== null && row.rate !== undefined && row.rate >= rateLo && row.rate <= rateHi);
    }

    const qtyLo = qtyMin.trim() !== "" ? parseFloat(qtyMin) : Number.NEGATIVE_INFINITY;
    const qtyHi = qtyMax.trim() !== "" ? parseFloat(qtyMax) : Number.POSITIVE_INFINITY;
    if (isFinite(qtyLo) || isFinite(qtyHi)) {
      rows = rows.filter(row => row.invoiceQty !== null && row.invoiceQty !== undefined && row.invoiceQty >= qtyLo && row.invoiceQty <= qtyHi);
    }

    const amtLo = amtMin.trim() !== "" ? parseFloat(amtMin) : Number.NEGATIVE_INFINITY;
    const amtHi = amtMax.trim() !== "" ? parseFloat(amtMax) : Number.POSITIVE_INFINITY;
    if (isFinite(amtLo) || isFinite(amtHi)) {
      rows = rows.filter(row => row.invoiceAmt !== null && row.invoiceAmt !== undefined && row.invoiceAmt >= amtLo && row.invoiceAmt <= amtHi);
    }

    return rows;
  }, [
    displayData, search, colSearches,
    saleBillDateStart, saleBillDateEnd,
    partyRefDateStart, partyRefDateEnd,
    certSentDateStart, certSentDateEnd,
    rateMin, rateMax, qtyMin, qtyMax, amtMin, amtMax,
    selectedParties,
    selectedItems,
    selectedPartyRefs,
    selectedContracts,
    selectedQuotations,
    selectedDockets,
    selectedUtilities,
    selectedFy,
    selectedBillNos,
    selectedItemCodes,
    selectedLrNos,
    selectedDocs,
    selectedItemSchedules,
    selectedEmails,
    selectedContacts,
  ]);

  const partyNamesList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.partyName) set.add(r.partyName.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const itemNamesList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.itemName) set.add(r.itemName.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const partyRefsList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.partyRefNo) set.add(r.partyRefNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const contractsList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.contractVrNo) set.add(r.contractVrNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const quotationNosList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.quotationNo) set.add(r.quotationNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const docketsList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.docketNo) set.add(r.docketNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const utilitiesList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.utility) set.add(r.utility.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const fyList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.fy) set.add(r.fy.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const billNosList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.saleBillNumber) set.add(r.saleBillNumber.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const itemCodesList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.itemCode) set.add(r.itemCode.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const lrNosList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.lrNo) set.add(r.lrNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const itemSchedulesList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.itemSchedule) set.add(r.itemSchedule.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const emailsList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.email) set.add(r.email.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const contactsList = useMemo(() => {
    const set = new Set<string>();
    displayData.forEach(r => { if (r.contactNo) set.add(r.contactNo.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [displayData]);

  const docsList = useMemo(() => ["All", "Yes", "No"], []);

  const sorted = useMemo<SupplyHistoryRecord[]>(() => {
    return [...filtered].sort((a, b) => cmp(a[sortField], b[sortField], sortDir));
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart  = (page - 1) * pageSize;
  const paginated  = sorted.slice(pageStart, pageStart + pageSize);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  const handleRefresh = async () => { setPage(1); await refresh(); };

  const handleScanDocuments = async () => {
    setIndexing(true);
    try {
      const res = await fetch("/api/supply-indexer", { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await refresh();
      toast.success("Documents scanned successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
      console.error("Index scan failed:", err);
    } finally {
      setIndexing(false);
    }
  };

  const handleSyncQuotation = async () => {
    setSyncingQuotation(true);
    try {
      const res = await fetch("/api/supply-history/sync-quotation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE",
        },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Sync failed");
      const s = json.stats;
      const errCount = s?.errors?.length ?? 0;
      toast.success(
        `Quotation sync done: ${s?.updated ?? 0} records updated (${s?.totalContracts ?? 0} contracts, ${errCount} errors)`
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Quotation sync failed");
      console.error("Quotation sync failed:", err);
    } finally {
      setSyncingQuotation(false);
    }
  };

  const handleDownloadAllDocuments = useCallback(async () => {
    const withDocs = filtered.filter(r => r.hasDocuments && r.saleBillNumber);
    if (withDocs.length === 0) {
      toast.info("No document records found in current view");
      return;
    }

    const driveOnly = filtered.filter(r => !r.hasDocuments && r.attachmentUrl);
    const billNumbers = withDocs.map(r => r.saleBillNumber!).filter(Boolean);

    setDownloadingDocs(true);
    try {
      const res = await fetch("/api/supply-history/download-documents-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE" },
        body: JSON.stringify({ saleBillNumbers: billNumbers }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || "Download failed");
      }

      const blob = await res.blob();
      const date = new Date().toISOString().split("T")[0];
      triggerDownload(blob, `Supply_Documents_${date}.zip`);

      if (driveOnly.length > 0) {
        toast.info(`${driveOnly.length} record(s) with only Google Drive documents were excluded from the zip`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to download documents");
    } finally {
      setDownloadingDocs(false);
    }
  }, [filtered, triggerDownload]);

  const handleExportAndDownload = useCallback(async () => {
    setExportingAll(true)
    const date = new Date().toISOString().split("T")[0]

    try {
      const exportData = displayData.map((rec) => {
        const obj: Record<string, string | number | boolean> = {};
        for (const col of COLUMNS) {
          const val = (rec as any)[col.key];
          if (col.key === "certificateSentDate") {
            obj[col.label] = val ? (formatDate(val) ?? val) : "Not Sent";
          } else {
            obj[col.label] = val ?? "";
          }
        }
        return obj;
      });
      // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Supply History");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const excelBlob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      triggerDownload(excelBlob, `Supply_History_Data_${date}.xlsx`)
    } catch (err) {
      console.error("Excel export failed:", err)
      toast.error("Failed to export Excel")
      setExportingAll(false)
      return
    }

    const withDocs = filtered.filter(r => r.hasDocuments && r.saleBillNumber)
    if (withDocs.length === 0) {
      toast.info("Excel exported. No documents to zip.")
      setExportingAll(false)
      return
    }

    const billNumbers = withDocs.map(r => r.saleBillNumber!).filter(Boolean)

    try {
      const res = await fetch("/api/supply-history/download-documents-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE" },
        body: JSON.stringify({ saleBillNumbers: billNumbers }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }))
        throw new Error(err.error || "Download failed")
      }

      const zipBlob = await res.blob()
      triggerDownload(zipBlob, `Supply_Documents_${date}.zip`)

      const driveOnly = filtered.filter(r => !r.hasDocuments && r.attachmentUrl)
      if (driveOnly.length > 0) {
        toast.info(`${driveOnly.length} record(s) with only Google Drive documents were excluded from the zip`)
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to download documents")
    } finally {
      setExportingAll(false)
    }
  }, [displayData, filtered, triggerDownload])

  const handleExportExcel = async () => {
    const exportData = sorted.map((rec) => {
      const obj: Record<string, string | number | boolean> = {};
      for (const col of COLUMNS) {
        const val = (rec as any)[col.key];
        if (col.key === "certificateSentDate") {
          obj[col.label] = val ? (formatDate(val) ?? val) : "Not Sent";
        } else {
          obj[col.label] = val ?? "";
        }
      }
      return obj;
    });
    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Supply History");
    const date = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Supply_History_Data_${date}.xlsx`);
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

  const totalRecords  = filtered.length;
  const totalAmt      = filtered.reduce((sum, r) => sum + (r.invoiceAmt || 0), 0);
  const totalQty      = filtered.reduce((sum, r) => sum + (r.invoiceQty || 0), 0);
  const withBillNo    = filtered.filter(r => r.saleBillNumber).length;

  return (
    <div className="supply-layout-container">
      <aside className="supply-sidebar">
        <div className="supply-sidebar-header" style={{ display: "flex", alignItems: "center", gap: "8px" }}><Package size={18} /> Supply History</div>
        <div className="supply-sidebar-body">
          <div className="supply-stat-card">
            <div className="supply-stat-label">Total Records</div>
            <div className="supply-stat-value">{totalRecords.toLocaleString()}</div>
            <div className="supply-stat-sub">from Google Sheet</div>
          </div>
          <div className="supply-stat-card">
            <div className="supply-stat-label">Total Invoice Amt</div>
            <div className="supply-stat-value" style={{ color: "#38ef7d" }}>
              ₹{totalAmt.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="supply-stat-card">
            <div className="supply-stat-label">Total Invoice Qty</div>
            <div className="supply-stat-value" style={{ color: "#69b2ff" }}>
              {totalQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="supply-stat-card">
            <div className="supply-stat-label">With Bill No</div>
            <div className="supply-stat-value" style={{ color: "#ff6b6b" }}>
              {withBillNo.toLocaleString()}
            </div>
          </div>

          <div className="supply-filter-section">
            <div className="supply-filter-label">Search</div>
            <input
              className="supply-filter-input"
              type="text"
              placeholder="Search all columns..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="supply-sidebar-footer">
          <button
            className="supply-refresh-sidebar-btn"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? <><RefreshCw size={14} /> Loading...</> : <><RefreshCw size={14} /> Refresh Data</>}
          </button>
          <button
            className="supply-refresh-sidebar-btn"
            onClick={handleScanDocuments}
            disabled={indexing}
            style={{ marginTop: "8px" }}
          >
            {indexing ? <><RefreshCw size={14} /> Scanning...</> : <><FolderOpen size={14} /> Scan Documents</>}
          </button>
          <button
            className="supply-refresh-sidebar-btn"
            onClick={handleSyncQuotation}
            disabled={syncingQuotation}
            style={{ marginTop: "8px" }}
          >
            {syncingQuotation ? <><RefreshCw size={14} /> Syncing...</> : <><RefreshCw size={14} /> Sync Quotation No</>}
          </button>
        </div>
      </aside>

      <div className="supply-workspace">
        <header className="supply-top-header">
          <div className="supply-header-brand">
            <h1 className="supply-header-title">G M DALUI <span>SUPPLY</span></h1>
            <div className="supply-header-divider" />
            <span className="supply-header-subtitle">Supply History Dashboard</span>
          </div>
          <div className="supply-header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Eraser size={14} /> Clear Filters
            </button>
            <button className="export-excel-btn" onClick={handleExportExcel} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <FileSpreadsheet size={14} /> Export Excel
            </button>
            <button
              className="export-excel-btn"
              onClick={handleDownloadAllDocuments}
              disabled={downloadingDocs}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              {downloadingDocs ? <><RefreshCw size={14} /> Zipping...</> : <><Download size={14} /> Download All Docs</>}
            </button>
            <button
              className="export-excel-btn"
              onClick={handleExportAndDownload}
              disabled={exportingAll}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              {exportingAll ? <><RefreshCw size={14} /> Processing...</> : <><Download size={14} /> Export & Download</>}
            </button>
            <button
              className="clear-filters-btn"
              onClick={() => window.open("https://docs.google.com/spreadsheets/d/1tXiJC9AZNiAAoL8mM_KxKuzrFqzuk-n3n16abJbaam0", "_blank", "noopener,noreferrer")}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <ExternalLink size={14} /> Open Sheet
            </button>
          </div>
        </header>

        <main className="supply-body">
          {loading && (
            <div className="supply-table-container">
              <div className="supply-state-wrapper">
                <div className="supply-spinner" />
                <span className="supply-state-title">Fetching Supply History Data...</span>
                <span className="supply-state-sub">Connecting to Google Sheets API and loading records.</span>
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="supply-table-container">
              <div className="supply-state-wrapper">
                <span className="supply-state-icon" style={{ display: "inline-flex", alignItems: "center" }}><AlertTriangle size={24} /></span>
                <h3 className="supply-error-title">Failed to Load Supply Data</h3>
                <p className="supply-state-sub">{error.message}</p>
                <div className="supply-error-code">{error.message}</div>
                <button className="supply-retry-btn" onClick={handleRefresh}>
                  Retry Connection
                </button>
              </div>
            </div>
          )}

          {!loading && !error && (
            <div className="supply-table-container">
              <div className="supply-toolbar">
                <div className="supply-toolbar-left">
                  <p className="supply-table-title">Supply Records</p>
                  <span className="supply-record-badge">
                    {filtered.length.toLocaleString()} of {displayData.length.toLocaleString()} Records
                  </span>
                  <div className="supply-search-container">
                    <span className="supply-search-icon" style={{ display: "inline-flex", alignItems: "center" }}><Search size={16} /></span>
                    <input
                      id="supply-global-search"
                      type="text"
                      className="supply-search-input"
                      placeholder="Search all columns..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                  </div>
                </div>
              </div>

              <div className="supply-table-wrapper">
                <table className="supply-data-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(col => (
                        <th
                          key={col.key}
                          style={{ width: `${columnWidths[col.key]}px`, minWidth: `${columnWidths[col.key]}px` }}
                        >
                          <div className="supply-th-inner" onClick={() => handleSort(col.key)}>
                            {col.label}
                            <span className="supply-sort-icon">
                              {sortField === col.key
                                ? sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                : <ArrowUpDown size={12} />}
                            </span>
                          </div>
                          <div className="column-filter-container" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                            <div className="column-search-wrap">
                              <input
                                type="text"
                                className="column-search-input"
                                placeholder="Search..."
                                value={colSearches[col.key] || ""}
                                onChange={e => handleColSearchChange(col.key, e.target.value)}
                              />
                              {colSearches[col.key] && (
                                <button
                                  className="column-search-clear-btn"
                                  onClick={() => handleColSearchChange(col.key, "")}
                                  title="Clear search"
                                  style={{ display: "inline-flex", alignItems: "center" }}
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            {col.key === "saleBillDate" && (
                              <div className="column-date-filter">
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={saleBillDateStart}
                                  onChange={e => { setSaleBillDateStart(e.target.value); setPage(1); }}
                                  title="Start Date"
                                />
                                <span className="date-filter-to">to</span>
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={saleBillDateEnd}
                                  onChange={e => { setSaleBillDateEnd(e.target.value); setPage(1); }}
                                  title="End Date"
                                />
                                {(saleBillDateStart || saleBillDateEnd) && (
                                  <button
                                    className="date-filter-clear-btn"
                                    onClick={() => { setSaleBillDateStart(""); setSaleBillDateEnd(""); setPage(1); }}
                                    title="Clear date filter"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                            {col.key === "partyRefDate" && (
                              <div className="column-date-filter">
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={partyRefDateStart}
                                  onChange={e => { setPartyRefDateStart(e.target.value); setPage(1); }}
                                  title="Start Date"
                                />
                                <span className="date-filter-to">to</span>
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={partyRefDateEnd}
                                  onChange={e => { setPartyRefDateEnd(e.target.value); setPage(1); }}
                                  title="End Date"
                                />
                                {(partyRefDateStart || partyRefDateEnd) && (
                                  <button
                                    className="date-filter-clear-btn"
                                    onClick={() => { setPartyRefDateStart(""); setPartyRefDateEnd(""); setPage(1); }}
                                    title="Clear date filter"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                            {col.key === "certificateSentDate" && (
                              <div className="column-date-filter">
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={certSentDateStart}
                                  onChange={e => { setCertSentDateStart(e.target.value); setPage(1); }}
                                  title="Start Date"
                                />
                                <span className="date-filter-to">to</span>
                                <input
                                  type="date"
                                  className="date-filter-input"
                                  value={certSentDateEnd}
                                  onChange={e => { setCertSentDateEnd(e.target.value); setPage(1); }}
                                  title="End Date"
                                />
                                {(certSentDateStart || certSentDateEnd) && (
                                  <button
                                    className="date-filter-clear-btn"
                                    onClick={() => { setCertSentDateStart(""); setCertSentDateEnd(""); setPage(1); }}
                                    title="Clear date filter"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                            {col.key === "rate" && (
                              <div className="column-numeric-filter">
                                <input
                                  type="number"
                                  placeholder="Min"
                                  className="col-price-filter-input"
                                  value={rateMin}
                                  onChange={e => { setRateMin(e.target.value); setPage(1); }}
                                  title="Rate Min"
                                />
                                <span className="filter-row-dash">-</span>
                                <input
                                  type="number"
                                  placeholder="Max"
                                  className="col-price-filter-input"
                                  value={rateMax}
                                  onChange={e => { setRateMax(e.target.value); setPage(1); }}
                                  title="Rate Max"
                                />
                              </div>
                            )}
                            {col.key === "invoiceQty" && (
                              <div className="column-numeric-filter">
                                <input
                                  type="number"
                                  placeholder="Min"
                                  className="col-price-filter-input"
                                  value={qtyMin}
                                  onChange={e => { setQtyMin(e.target.value); setPage(1); }}
                                  title="Qty Min"
                                />
                                <span className="filter-row-dash">-</span>
                                <input
                                  type="number"
                                  placeholder="Max"
                                  className="col-price-filter-input"
                                  value={qtyMax}
                                  onChange={e => { setQtyMax(e.target.value); setPage(1); }}
                                  title="Qty Max"
                                />
                              </div>
                            )}
                            {col.key === "invoiceAmt" && (
                              <div className="column-numeric-filter">
                                <input
                                  type="number"
                                  placeholder="Min"
                                  className="col-price-filter-input"
                                  value={amtMin}
                                  onChange={e => { setAmtMin(e.target.value); setPage(1); }}
                                  title="Amt Min"
                                />
                                <span className="filter-row-dash">-</span>
                                <input
                                  type="number"
                                  placeholder="Max"
                                  className="col-price-filter-input"
                                  value={amtMax}
                                  onChange={e => { setAmtMax(e.target.value); setPage(1); }}
                                  title="Amt Max"
                                />
                              </div>
                            )}
                            {col.key === "partyName" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Parties"
                                selected={selectedParties}
                                options={partyNamesList.filter(p => p !== "All")}
                                show={showPartyDropdown}
                                onToggleShow={() => setShowPartyDropdown(!showPartyDropdown)}
                                onToggleOption={(party) => {
                                  if (selectedParties.includes(party)) {
                                    setSelectedParties(selectedParties.filter(p => p !== party));
                                  } else {
                                    setSelectedParties([...selectedParties, party]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedParties([]); setPage(1); }}
                                onSelectAll={() => { setSelectedParties(partyNamesList.filter(p => p !== "All")); setPage(1); }}
                                containerRef={partyDropdownRef}
                              />
                            )}
                            {col.key === "itemName" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Items"
                                selected={selectedItems}
                                options={itemNamesList.filter(i => i !== "All")}
                                show={showItemDropdown}
                                onToggleShow={() => setShowItemDropdown(!showItemDropdown)}
                                onToggleOption={(item) => {
                                  if (selectedItems.includes(item)) {
                                    setSelectedItems(selectedItems.filter(i => i !== item));
                                  } else {
                                    setSelectedItems([...selectedItems, item]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedItems([]); setPage(1); }}
                                onSelectAll={() => { setSelectedItems(itemNamesList.filter(i => i !== "All")); setPage(1); }}
                                containerRef={itemDropdownRef}
                              />
                            )}
                            {col.key === "partyRefNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Party Refs"
                                selected={selectedPartyRefs}
                                options={partyRefsList.filter(p => p !== "All")}
                                show={showPartyRefDropdown}
                                onToggleShow={() => setShowPartyRefDropdown(!showPartyRefDropdown)}
                                onToggleOption={(refNo) => {
                                  if (selectedPartyRefs.includes(refNo)) {
                                    setSelectedPartyRefs(selectedPartyRefs.filter(p => p !== refNo));
                                  } else {
                                    setSelectedPartyRefs([...selectedPartyRefs, refNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedPartyRefs([]); setPage(1); }}
                                onSelectAll={() => { setSelectedPartyRefs(partyRefsList.filter(p => p !== "All")); setPage(1); }}
                                containerRef={partyRefDropdownRef}
                              />
                            )}
                            {col.key === "contractVrNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Contracts"
                                selected={selectedContracts}
                                options={contractsList.filter(c => c !== "All")}
                                show={showContractDropdown}
                                onToggleShow={() => setShowContractDropdown(!showContractDropdown)}
                                onToggleOption={(cNo) => {
                                  if (selectedContracts.includes(cNo)) {
                                    setSelectedContracts(selectedContracts.filter(c => c !== cNo));
                                  } else {
                                    setSelectedContracts([...selectedContracts, cNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedContracts([]); setPage(1); }}
                                onSelectAll={() => { setSelectedContracts(contractsList.filter(c => c !== "All")); setPage(1); }}
                                containerRef={contractDropdownRef}
                              />
                            )}
                            {col.key === "quotationNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Quotations"
                                selected={selectedQuotations}
                                options={quotationNosList.filter(q => q !== "All")}
                                show={showQuotationDropdown}
                                onToggleShow={() => setShowQuotationDropdown(!showQuotationDropdown)}
                                onToggleOption={(qNo) => {
                                  if (selectedQuotations.includes(qNo)) {
                                    setSelectedQuotations(selectedQuotations.filter(q => q !== qNo));
                                  } else {
                                    setSelectedQuotations([...selectedQuotations, qNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedQuotations([]); setPage(1); }}
                                onSelectAll={() => { setSelectedQuotations(quotationNosList.filter(q => q !== "All")); setPage(1); }}
                                containerRef={quotationDropdownRef}
                              />
                            )}
                            {col.key === "docketNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Docket Nos"
                                selected={selectedDockets}
                                options={docketsList.filter(d => d !== "All")}
                                show={showDocketDropdown}
                                onToggleShow={() => setShowDocketDropdown(!showDocketDropdown)}
                                onToggleOption={(dNo) => {
                                  if (selectedDockets.includes(dNo)) {
                                    setSelectedDockets(selectedDockets.filter(d => d !== dNo));
                                  } else {
                                    setSelectedDockets([...selectedDockets, dNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedDockets([]); setPage(1); }}
                                onSelectAll={() => { setSelectedDockets(docketsList.filter(d => d !== "All")); setPage(1); }}
                                containerRef={docketDropdownRef}
                              />
                            )}
                            {col.key === "utility" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Utilities"
                                selected={selectedUtilities}
                                options={utilitiesList.filter(u => u !== "All")}
                                show={showUtilityDropdown}
                                onToggleShow={() => setShowUtilityDropdown(!showUtilityDropdown)}
                                onToggleOption={(uVal) => {
                                  if (selectedUtilities.includes(uVal)) {
                                    setSelectedUtilities(selectedUtilities.filter(u => u !== uVal));
                                  } else {
                                    setSelectedUtilities([...selectedUtilities, uVal]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedUtilities([]); setPage(1); }}
                                onSelectAll={() => { setSelectedUtilities(utilitiesList.filter(u => u !== "All")); setPage(1); }}
                                containerRef={utilityDropdownRef}
                              />
                            )}
                            {col.key === "fy" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All FY"
                                selected={selectedFy}
                                options={fyList.filter(f => f !== "All")}
                                show={showFyDropdown}
                                onToggleShow={() => setShowFyDropdown(!showFyDropdown)}
                                onToggleOption={(fy) => {
                                  if (selectedFy.includes(fy)) {
                                    setSelectedFy(selectedFy.filter(f => f !== fy));
                                  } else {
                                    setSelectedFy([...selectedFy, fy]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedFy([]); setPage(1); }}
                                onSelectAll={() => { setSelectedFy(fyList.filter(f => f !== "All")); setPage(1); }}
                                containerRef={fyDropdownRef}
                              />
                            )}
                            {col.key === "saleBillNumber" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Bill Nos"
                                selected={selectedBillNos}
                                options={billNosList.filter(b => b !== "All")}
                                show={showBillNoDropdown}
                                onToggleShow={() => setShowBillNoDropdown(!showBillNoDropdown)}
                                onToggleOption={(bNo) => {
                                  if (selectedBillNos.includes(bNo)) {
                                    setSelectedBillNos(selectedBillNos.filter(b => b !== bNo));
                                  } else {
                                    setSelectedBillNos([...selectedBillNos, bNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedBillNos([]); setPage(1); }}
                                onSelectAll={() => { setSelectedBillNos(billNosList.filter(b => b !== "All")); setPage(1); }}
                                containerRef={billNoDropdownRef}
                              />
                            )}
                            {col.key === "itemCode" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Item Codes"
                                selected={selectedItemCodes}
                                options={itemCodesList.filter(i => i !== "All")}
                                show={showItemCodeDropdown}
                                onToggleShow={() => setShowItemCodeDropdown(!showItemCodeDropdown)}
                                onToggleOption={(code) => {
                                  if (selectedItemCodes.includes(code)) {
                                    setSelectedItemCodes(selectedItemCodes.filter(c => c !== code));
                                  } else {
                                    setSelectedItemCodes([...selectedItemCodes, code]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedItemCodes([]); setPage(1); }}
                                onSelectAll={() => { setSelectedItemCodes(itemCodesList.filter(i => i !== "All")); setPage(1); }}
                                containerRef={itemCodeDropdownRef}
                              />
                            )}
                            {col.key === "lrNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All LR Nos"
                                selected={selectedLrNos}
                                options={lrNosList.filter(l => l !== "All")}
                                show={showLrNoDropdown}
                                onToggleShow={() => setShowLrNoDropdown(!showLrNoDropdown)}
                                onToggleOption={(lNo) => {
                                  if (selectedLrNos.includes(lNo)) {
                                    setSelectedLrNos(selectedLrNos.filter(l => l !== lNo));
                                  } else {
                                    setSelectedLrNos([...selectedLrNos, lNo]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedLrNos([]); setPage(1); }}
                                onSelectAll={() => { setSelectedLrNos(lrNosList.filter(l => l !== "All")); setPage(1); }}
                                containerRef={lrNoDropdownRef}
                              />
                            )}
                            {col.key === "itemSchedule" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Schedules"
                                selected={selectedItemSchedules}
                                options={itemSchedulesList.filter(s => s !== "All")}
                                show={showItemScheduleDropdown}
                                onToggleShow={() => setShowItemScheduleDropdown(!showItemScheduleDropdown)}
                                onToggleOption={(val) => {
                                  if (selectedItemSchedules.includes(val)) {
                                    setSelectedItemSchedules(selectedItemSchedules.filter(v => v !== val));
                                  } else {
                                    setSelectedItemSchedules([...selectedItemSchedules, val]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedItemSchedules([]); setPage(1); }}
                                onSelectAll={() => { setSelectedItemSchedules(itemSchedulesList.filter(v => v !== "All")); setPage(1); }}
                                containerRef={itemScheduleDropdownRef}
                              />
                            )}
                            {col.key === "email" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Emails"
                                selected={selectedEmails}
                                options={emailsList.filter(e => e !== "All")}
                                show={showEmailDropdown}
                                onToggleShow={() => setShowEmailDropdown(!showEmailDropdown)}
                                onToggleOption={(val) => {
                                  if (selectedEmails.includes(val)) {
                                    setSelectedEmails(selectedEmails.filter(v => v !== val));
                                  } else {
                                    setSelectedEmails([...selectedEmails, val]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedEmails([]); setPage(1); }}
                                onSelectAll={() => { setSelectedEmails(emailsList.filter(v => v !== "All")); setPage(1); }}
                                containerRef={emailDropdownRef}
                              />
                            )}
                            {col.key === "contactNo" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All Contacts"
                                selected={selectedContacts}
                                options={contactsList.filter(c => c !== "All")}
                                show={showContactDropdown}
                                onToggleShow={() => setShowContactDropdown(!showContactDropdown)}
                                onToggleOption={(val) => {
                                  if (selectedContacts.includes(val)) {
                                    setSelectedContacts(selectedContacts.filter(v => v !== val));
                                  } else {
                                    setSelectedContacts([...selectedContacts, val]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedContacts([]); setPage(1); }}
                                onSelectAll={() => { setSelectedContacts(contactsList.filter(v => v !== "All")); setPage(1); }}
                                containerRef={contactDropdownRef}
                              />
                            )}
                            {col.key === "hasDocuments" && (
                              <ColumnMultiselectDropdown
                                triggerLabel="All"
                                selected={selectedDocs}
                                options={docsList.filter(d => d !== "All")}
                                show={showDocsDropdown}
                                onToggleShow={() => setShowDocsDropdown(!showDocsDropdown)}
                                onToggleOption={(doc) => {
                                  if (selectedDocs.includes(doc)) {
                                    setSelectedDocs(selectedDocs.filter(d => d !== doc));
                                  } else {
                                    setSelectedDocs([...selectedDocs, doc]);
                                  }
                                  setPage(1);
                                }}
                                onClearAll={() => { setSelectedDocs([]); setPage(1); }}
                                onSelectAll={() => { setSelectedDocs(docsList.filter(d => d !== "All")); setPage(1); }}
                                containerRef={docsDropdownRef}
                              />
                            )}
                          </div>
                          <div
                            className="column-resizer"
                            onMouseDown={(e) => handleResizeStart(e, col.key, columnWidths[col.key])}
                          />
                        </th>
                      ))}
                      <th style={{ width: "200px", minWidth: "200px" }}>
                        <div className="supply-th-inner">Certificate PDF</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 ? (
                      <tr>
                        <td
                          colSpan={COLUMNS.length + 1}
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
                      <tr key={pageStart + idx} className="supply-row">
                        <td className="col-center"><div className="supply-cell-text" style={{ textAlign: "center" }}>{row.fy ?? <span className="supply-null-cell">—</span>}</div></td>
                        <td title={row.saleBillNumber ?? undefined}>
                          <div className="supply-cell-text">{row.saleBillNumber ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td className="col-center">
                          {row.saleBillDate
                            ? <span className="supply-date-badge">{formatDate(row.saleBillDate)}</span>
                            : <span className="supply-null-cell">—</span>}
                        </td>
                        <td title={row.partyName ?? undefined}>
                          <div className="supply-cell-text">{row.partyName ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.itemCode ?? undefined}>
                          <div className="supply-cell-text">{row.itemCode ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.itemSchedule ?? undefined} style={{ position: "relative" }}>
                          {(() => {
                            const isEditing = editingCell?.saleBillNumber === row.saleBillNumber && editingCell?.itemCode === row.itemCode && editingCell?.field === "itemSchedule";
                            const key = `${row.saleBillNumber}|${row.itemCode}|itemSchedule`;
                            const isSaving = savingCells.has(key);
                            if (isEditing) {
                              return (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e)=>e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={editingDraft}
                                    onChange={(e)=>setEditingDraft(e.target.value)}
                                    onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); handleEditSave(); } else if(e.key==="Escape"){ handleEditCancel(); } }}
                                    autoFocus
                                    disabled={isSaving}
                                    placeholder="Item Schedule"
                                    style={{ fontSize: "12px", padding: "2px 6px", border: "1px solid #dadce0", borderRadius: 4, width: 140 }}
                                  />
                                  <button onClick={handleEditSave} disabled={isSaving} title="Save" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"var(--color-brand-accent)", color:"#fff", border:"none", cursor:"pointer" }}><Check size={12} /></button>
                                  <button onClick={handleEditCancel} disabled={isSaving} title="Cancel" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"#e8eaed", color:"#5f6368", border:"none", cursor:"pointer" }}><X size={12} /></button>
                                </div>
                              );
                            }
                            return (
                              <div style={{ display:"flex", alignItems:"flex-start", gap:6, justifyContent:"space-between" }}>
                                <span title={row.itemSchedule ?? undefined} className="supply-cell-text">{row.itemSchedule ?? <span className="supply-null-cell">—</span>}</span>
                                <button onClick={()=>handleEditStart(row, "itemSchedule")} title="Edit Item Schedule" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:20, height:20, borderRadius:"50%", background:"#f1f3f4", border:"1px solid #dadce0", cursor:"pointer", flexShrink:0, marginTop:2 }}><Pencil size={10} /></button>
                              </div>
                            );
                          })()}
                        </td>
                        <td title={row.itemName ?? undefined}>
                          <div className="supply-cell-text">{row.itemName ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.lrNo ?? undefined}>
                          <div className="supply-cell-text">{row.lrNo ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.partyRefNo ?? undefined}>
                          <div className="supply-cell-text">{row.partyRefNo ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td className="col-center">
                          {row.partyRefDate
                            ? <span className="supply-date-badge">{formatDate(row.partyRefDate)}</span>
                            : <span className="supply-null-cell">—</span>}
                        </td>
                        <td title={row.contractVrNo ?? undefined}>
                          <div className="supply-cell-text">{row.contractVrNo ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.quotationNo ?? undefined}>
                          <div className="supply-cell-text">{row.quotationNo ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.docketNo ?? undefined}>
                          <div className="supply-cell-text">{row.docketNo ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td title={row.utility ?? undefined}>
                          <div className="supply-cell-text">{row.utility ?? <span className="supply-null-cell">—</span>}</div>
                        </td>
                        <td className="supply-number-cell">
                          {row.rate !== null && row.rate !== undefined
                            ? formatNumber(row.rate)
                            : <span className="supply-null-cell">—</span>}
                        </td>
                        <td className="supply-number-cell">
                          {row.invoiceQty !== null && row.invoiceQty !== undefined
                            ? formatNumber(row.invoiceQty)
                            : <span className="supply-null-cell">—</span>}
                        </td>
                        <td className="supply-number-cell">
                          {row.invoiceAmt !== null && row.invoiceAmt !== undefined
                            ? formatNumber(row.invoiceAmt)
                            : <span className="supply-null-cell">—</span>}
                        </td>
                        <td title={row.email ?? undefined} style={{ position: "relative" }}>
                          {(() => {
                            const isEditing = editingCell?.saleBillNumber === row.saleBillNumber && editingCell?.itemCode === row.itemCode && editingCell?.field === "email";
                            const key = `${row.saleBillNumber}|${row.itemCode}|email`;
                            const isSaving = savingCells.has(key);
                            if (isEditing) {
                              return (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e)=>e.stopPropagation()}>
                                  <input
                                    type="email"
                                    value={editingDraft}
                                    onChange={(e)=>setEditingDraft(e.target.value)}
                                    onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); handleEditSave(); } else if(e.key==="Escape"){ handleEditCancel(); } }}
                                    autoFocus
                                    disabled={isSaving}
                                    placeholder="a@x.com, b@y.com"
                                    title="Separate multiple emails with comma"
                                    style={{ fontSize: "12px", padding: "2px 6px", border: "1px solid #dadce0", borderRadius: 4, width: 160 }}
                                  />
                                  <button onClick={handleEditSave} disabled={isSaving} title="Save" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"var(--color-brand-accent)", color:"#fff", border:"none", cursor:"pointer" }}><Check size={12} /></button>
                                  <button onClick={handleEditCancel} disabled={isSaving} title="Cancel" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"#e8eaed", color:"#5f6368", border:"none", cursor:"pointer" }}><X size={12} /></button>
                                </div>
                              );
                            }
                            return (
                              <div style={{ display:"flex", alignItems:"flex-start", gap:6, justifyContent:"space-between" }}>
                                <span title={row.email ?? undefined} className="supply-cell-text">{row.email ?? <span className="supply-null-cell">—</span>}</span>
                                <button onClick={()=>handleEditStart(row, "email")} title="Edit Email" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:20, height:20, borderRadius:"50%", background:"#f1f3f4", border:"1px solid #dadce0", cursor:"pointer", flexShrink:0, marginTop:2 }}><Pencil size={10} /></button>
                              </div>
                            );
                          })()}
                        </td>
                        <td title={row.contactNo ?? undefined} style={{ position: "relative" }}>
                          {(() => {
                            const isEditing = editingCell?.saleBillNumber === row.saleBillNumber && editingCell?.itemCode === row.itemCode && editingCell?.field === "contactNo";
                            const key = `${row.saleBillNumber}|${row.itemCode}|contactNo`;
                            const isSaving = savingCells.has(key);
                            if (isEditing) {
                              return (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e)=>e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={editingDraft}
                                    onChange={(e)=>setEditingDraft(e.target.value)}
                                    onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); handleEditSave(); } else if(e.key==="Escape"){ handleEditCancel(); } }}
                                    autoFocus
                                    disabled={isSaving}
                                    placeholder="Contact No"
                                    style={{ fontSize: "12px", padding: "2px 6px", border: "1px solid #dadce0", borderRadius: 4, width: 120 }}
                                  />
                                  <button onClick={handleEditSave} disabled={isSaving} title="Save" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"var(--color-brand-accent)", color:"#fff", border:"none", cursor:"pointer" }}><Check size={12} /></button>
                                  <button onClick={handleEditCancel} disabled={isSaving} title="Cancel" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:22, borderRadius:"50%", background:"#e8eaed", color:"#5f6368", border:"none", cursor:"pointer" }}><X size={12} /></button>
                                </div>
                              );
                            }
                            return (
                              <div style={{ display:"flex", alignItems:"flex-start", gap:6, justifyContent:"space-between" }}>
                                <span title={row.contactNo ?? undefined} className="supply-cell-text">{row.contactNo ?? <span className="supply-null-cell">—</span>}</span>
                                <button onClick={()=>handleEditStart(row, "contactNo")} title="Edit Contact No" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:20, height:20, borderRadius:"50%", background:"#f1f3f4", border:"1px solid #dadce0", cursor:"pointer", flexShrink:0, marginTop:2 }}><Pencil size={10} /></button>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="col-center">
                          {row.hasDocuments || row.attachmentUrl ? (
                            <button
                              className="view-docs-btn"
                              onClick={() => {
                                setSelectedBillNo(row.saleBillNumber);
                                setSelectedAttachmentUrl(row.attachmentUrl ?? null);
                              }}
                              title="View Documents"
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            >
                              <FolderOpen size={14} /> View Files
                            </button>
                          ) : (
                            <span className="supply-null-cell">—</span>
                          )}
                        </td>
                        <td className="col-center">
                          {row.certificateSentDate ? (
                            <span className="supply-date-badge">{formatDate(row.certificateSentDate)}</span>
                          ) : (
                            <span className="supply-null-cell">Not Sent</span>
                          )}
                        </td>
                        <td className="col-center">
                          {!row.partyRefNo ? (
                            <span className="supply-null-cell">—</span>
                          ) : (() => {
                            const state = certStates[row.partyRefNo] ?? { status: "idle" };
                            const hasCert = !!(row as any).certificateUrl || state.status === "ready" || state.status === "emailSent" || state.status === "emailSending";
                            const groupEmails = displayData.filter((r) => r.partyRefNo === row.partyRefNo).map((r) => r.email).filter(Boolean) as string[];
                            const hasEmail = groupEmails.length > 0;
                            if (state.status === "generating") {
                              return <span className="supply-generating"><span className="supply-spinner-sm" /> Generating...</span>;
                            }
                            if (state.status === "emailSending") {
                              return <span className="supply-generating"><Loader2 size={12} className="animate-spin" /> Sending...</span>;
                            }
                            if (state.status === "emailSent") {
                              return (
                                <span className="supply-generating" style={{ color: "#16a34a", fontWeight: 600 }}>
                                  <Send size={12} /> Sent!
                                </span>
                              );
                            }
                            if (state.status === "error") {
                              return (
                                <button
                                  className="retry-pdf-btn"
                                  onClick={() => handleGenerateCertificate(row.partyRefNo!)}
                                  title={state.error}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                                >
                                  <RefreshCw size={14} /> Retry
                                </button>
                              );
                            }
                            // Has certificate → show Generate + Send Email
                            if (hasCert) {
                              return (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <button
                                    className="generate-pdf-btn"
                                    onClick={() => handleGenerateCertificate(row.partyRefNo!)}
                                    title="Re-generate certificate"
                                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px", fontSize: 11 }}
                                  >
                                    <FileText size={12} /> PDF
                                  </button>
                                  <button
                                    className="send-email-btn"
                                    onClick={() => handleSendCertificateEmail(row.partyRefNo!)}
                                    disabled={!hasEmail}
                                    title={!hasEmail ? "No recipient email — add Email first" : `Send to ${groupEmails[0]}${groupEmails.length > 1 ? ` + ${groupEmails.length - 1} cc` : ""}`}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                                  >
                                    <Mail size={12} /> Send Email
                                  </button>
                                </div>
                              );
                            }
                            return (
                              <button
                                className="generate-pdf-btn"
                                onClick={() => handleGenerateCertificate(row.partyRefNo!)}
                                style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                              >
                                <FileText size={14} /> Generate PDF
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="supply-table-footer">
                <div className="supply-footer-left">
                  <span>Rows per page:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                  >
                    <SelectTrigger size="sm" className="supply-rows-select h-7 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="supply-footer-center">
                  {pageStart + 1}–{Math.min(pageStart + pageSize, sorted.length)} of {sorted.length}
                </div>
                <div className="supply-pagination">
                  <button className="supply-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                  {pageNumbers().map((p, i) =>
                    p === "..." ? (
                      <span key={`e${i}`} style={{ padding: "0 4px", color: "#5f6368", fontSize: 12 }}>…</span>
                    ) : (
                      <button key={p} className={`supply-page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p as number)}>{p}</button>
                    )
                  )}
                  <button className="supply-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                </div>
              </div>
            </div>
          )}
        </main>

        <footer className="supply-status-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#137333" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#34a853", display: "inline-block", animation: "blink 1.5s infinite" }} />
              <span>SHEET LIVE</span>
            </div>
          </div>
          <div style={{ color: "var(--color-brand)", textTransform: "uppercase", fontWeight: 700 }}>
            G M DALUI SUPPLY PIPELINE
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ backgroundColor: "#e1e6eb", color: "var(--color-brand)", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
              G M DALUI ERP V2.1 PRO
            </span>
          </div>
        </footer>
      </div>

      <SupplyAttachmentModal
        isOpen={!!selectedBillNo}
        onClose={() => { setSelectedBillNo(null); setSelectedAttachmentUrl(null); }}
        saleBillNumber={selectedBillNo || ""}
        attachmentUrl={selectedAttachmentUrl}
      />
    </div>
  );
};

export default SupplyHistoryDashboard;
