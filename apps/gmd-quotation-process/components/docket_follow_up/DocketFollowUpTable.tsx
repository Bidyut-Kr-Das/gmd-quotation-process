"use client";

import React, { useState, useMemo } from "react";
import {
  Download,
  Eye,
  RotateCcw,
  Search,
  AlertCircle,
  FileCheck,
  CheckCircle2,
  Paperclip,
  FileText,
  Mail,
  Calendar,
  Clock,
  Send,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Filter,
  SlidersHorizontal,
  X,
  MapPin,
  Tag,
  Building2,
} from "lucide-react";
import { Badge } from "@gmd/ui/components/badge";
import { Button } from "@gmd/ui/components/button";
import ThreadDetailModal from "./ThreadDetailModal";
import * as XLSX from "xlsx";
import { MultiFilterDropdown, FilterOption } from "./MultiFilterDropdown";

interface DocketFollowUpRow {
  enquiryId: string;
  docketNumber: string;
  partyName: string;
  enquiryDate: string | null;
  enquiryType: string | null;
  state: string | null;
  utility: string | null;
  orderStatus?: string | null;
  closureStatus?: string | null;
  actionPending: boolean;
  threadsCount: number;

  // Quotation Sent & Date
  quotationSent: boolean;
  quotationSentDate: string | null;
  quotationMethod?: "ATTACHMENT" | "OCR" | "EMAIL" | null;

  // Party Reply Arrived
  partyReplyArrived: boolean;
  partyReplyStatus: "REPLY_ARRIVED" | "AWAITING_REPLY" | "NO_QUOTE";
  partyReplyDate: string | null;
  partyReplyEmail?: string | null;

  // Attachments & file sent
  fileSent: boolean;
  fileNames: string[];
  quoteFiles?: string[];
  enquiryFiles?: string[];
  hasEnquiryDocs?: boolean;
  attachLinks: Record<string, string>;

  // Contacts & recipients
  partyEmail: string | null;
  allRecipients: {
    to: string[];
    cc: string[];
  };

  // Follow-up & Days calculation
  replyStatus: "ACTION_PENDING" | "REPLIED" | "AWAITING_REPLY";
  daysWithoutReply: number | null;
  daysSinceLastActivity: number | null;
  lastCommunicationDays: number | null;
  lastCommunicationDate: string | null;

  // 3-Stage details
  partyRequestDetails?: any;
  quoteDetails?: any;
  partyReplyDetails?: any;
  allThreads?: any[];

  latestThread: {
    id: number;
    threadId: string;
    mailType: string;
    docketStatus: string | null;
    subject: string | null;
    sender: string | null;
    date: string | null;
    bodyPreview: string | null;
    body: string | null;
    msgCount?: number;
  } | null;
}

interface DocketFollowUpTableProps {
  rows: DocketFollowUpRow[];
}

function getPartyInitials(partyName: string): string {
  if (!partyName) return "NA";
  const clean = partyName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt)\b/gi, "")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return "EQ";
}

function getAvatarColor(initials: string): string {
  const charCode = (initials.charCodeAt(0) || 0) + (initials.charCodeAt(1) || 0);
  const colors = [
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/12 dark:text-blue-300 dark:border-blue-500/25",
    "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/12 dark:text-indigo-300 dark:border-indigo-500/25",
    "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/12 dark:text-sky-300 dark:border-sky-500/25",
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:border-emerald-500/25",
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/12 dark:text-amber-300 dark:border-amber-500/25",
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/12 dark:text-rose-300 dark:border-rose-500/25",
  ];
  return colors[charCode % colors.length];
}

export default function DocketFollowUpTable({ rows }: DocketFollowUpTableProps) {
  // Toggle for Advanced Multi-Filter Drawer
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Column In-Header & Advanced Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDocketNo, setFilterDocketNo] = useState("");
  
  // Multi-Select Filter States
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedOrderStatuses, setSelectedOrderStatuses] = useState<string[]>([]);
  const [selectedActionStatuses, setSelectedActionStatuses] = useState<string[]>([]);
  const [selectedQuoteStatuses, setSelectedQuoteStatuses] = useState<string[]>([]);
  const [selectedReplyStatuses, setSelectedReplyStatuses] = useState<string[]>([]);
  const [selectedFilesStatuses, setSelectedFilesStatuses] = useState<string[]>([]);

  const [filterPartyEmail, setFilterPartyEmail] = useState("");
  const [filterDuration, setFilterDuration] = useState("ALL"); // ALL | RECENT | MID | OVERDUE
  const [filterSender, setFilterSender] = useState("");

  // Sort State
  const [sortField, setSortField] = useState<string>("enquiryDate");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal inspection
  const [selectedRow, setSelectedRow] = useState<DocketFollowUpRow | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Extract Unique Dropdown Options
  const uniqueParties = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.partyName) set.add(r.partyName.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const uniqueStates = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.state) set.add(r.state.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const uniqueTypes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.enquiryType) set.add(r.enquiryType.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const uniqueOrderStatuses = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.orderStatus) set.add(r.orderStatus.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  // Multi-Filter Options with Live Counts
  const stateOptions: FilterOption[] = useMemo(() => {
    return uniqueStates.map((s) => ({
      value: s,
      label: s,
      count: rows.filter((r) => r.state === s).length,
    }));
  }, [uniqueStates, rows]);

  const typeOptions: FilterOption[] = useMemo(() => {
    return uniqueTypes.map((t) => ({
      value: t,
      label: t,
      count: rows.filter((r) => r.enquiryType === t).length,
    }));
  }, [uniqueTypes, rows]);

  const orderStatusOptions: FilterOption[] = useMemo(() => {
    return uniqueOrderStatuses.map((os) => ({
      value: os,
      label: os,
      count: rows.filter((r) => r.orderStatus === os).length,
    }));
  }, [uniqueOrderStatuses, rows]);

  const partyOptions: FilterOption[] = useMemo(() => {
    return uniqueParties.map((p) => ({
      value: p,
      label: p,
      count: rows.filter((r) => r.partyName === p).length,
    }));
  }, [uniqueParties, rows]);

  const actionStatusOptions: FilterOption[] = useMemo(
    () => [
      { value: "ACTIVE", label: "Email Found", count: rows.filter((r) => !r.actionPending).length },
      { value: "PENDING", label: "Action Pending", count: rows.filter((r) => r.actionPending).length },
    ],
    [rows]
  );

  const quoteStatusOptions: FilterOption[] = useMemo(
    () => [
      {
        value: "SENT",
        label: "Sent (All)",
        count: rows.filter((r) => r.quotationSent).length,
      },
      {
        value: "SENT_ATTACH",
        label: "Sent via Attachment",
        count: rows.filter((r) => r.quotationSent && r.quotationMethod === "ATTACHMENT").length,
      },
      {
        value: "SENT_OCR",
        label: "Sent via OCR",
        count: rows.filter((r) => r.quotationSent && r.quotationMethod === "OCR").length,
      },
      {
        value: "NOT_SENT",
        label: "Not Sent (Pending)",
        count: rows.filter((r) => !r.quotationSent).length,
      },
    ],
    [rows]
  );

  const partyReplyOptions: FilterOption[] = useMemo(
    () => [
      {
        value: "ARRIVED",
        label: "Reply Arrived",
        count: rows.filter((r) => r.partyReplyStatus === "REPLY_ARRIVED").length,
      },
      {
        value: "AWAITING",
        label: "Awaiting Reply",
        count: rows.filter((r) => r.partyReplyStatus === "AWAITING_REPLY").length,
      },
      {
        value: "OVERDUE",
        label: "Overdue (> 7 Days)",
        count: rows.filter(
          (r) => r.partyReplyStatus === "AWAITING_REPLY" && r.daysWithoutReply != null && r.daysWithoutReply > 7
        ).length,
      },
      {
        value: "NO_QUOTE",
        label: "No Quote Sent",
        count: rows.filter((r) => r.partyReplyStatus === "NO_QUOTE").length,
      },
    ],
    [rows]
  );

  const fileOptions: FilterOption[] = useMemo(
    () => [
      { value: "QUOTE_SENT", label: "Quote Files Sent", count: rows.filter((r) => r.fileSent).length },
      { value: "ENQUIRY_DOCS", label: "Enquiry Specs / Docs", count: rows.filter((r) => !r.fileSent && (r.hasEnquiryDocs || r.fileNames.length > 0)).length },
      { value: "NO_FILES", label: "No Attachments", count: rows.filter((r) => !r.fileSent && !r.hasEnquiryDocs && r.fileNames.length === 0).length },
    ],
    [rows]
  );

  // Filtering Logic with Multi-Filter support
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // 1. Date Filter
      if (filterDateFrom && r.enquiryDate) {
        if (new Date(r.enquiryDate) < new Date(filterDateFrom)) return false;
      }
      if (filterDateTo && r.enquiryDate) {
        const toDate = new Date(filterDateTo);
        toDate.setHours(23, 59, 59, 999);
        if (new Date(r.enquiryDate) > toDate) return false;
      }

      // 2. Docket No Filter
      if (filterDocketNo.trim()) {
        const q = filterDocketNo.toLowerCase();
        if (!r.docketNumber.toLowerCase().includes(q)) return false;
      }

      // 3. Multi-Select Party Filter
      if (selectedParties.length > 0) {
        if (!selectedParties.includes(r.partyName)) return false;
      }

      // 4. Multi-Select State Filter
      if (selectedStates.length > 0) {
        if (!r.state || !selectedStates.includes(r.state)) return false;
      }

      // 5. Multi-Select Enquiry Type Filter
      if (selectedTypes.length > 0) {
        if (!r.enquiryType || !selectedTypes.includes(r.enquiryType)) return false;
      }

      // 6. Multi-Select Order Status Filter
      if (selectedOrderStatuses.length > 0) {
        if (!r.orderStatus || !selectedOrderStatuses.includes(r.orderStatus)) return false;
      }

      // 7. Multi-Select Action Status Filter
      if (selectedActionStatuses.length > 0) {
        const matchesActive = selectedActionStatuses.includes("ACTIVE") && !r.actionPending;
        const matchesPending = selectedActionStatuses.includes("PENDING") && r.actionPending;
        if (!matchesActive && !matchesPending) return false;
      }

      // 8. Multi-Select Quotation Sent Filter
      if (selectedQuoteStatuses.length > 0) {
        const matches = selectedQuoteStatuses.some((status) => {
          if (status === "SENT") return r.quotationSent;
          if (status === "SENT_ATTACH") return r.quotationSent && r.quotationMethod === "ATTACHMENT";
          if (status === "SENT_OCR") return r.quotationSent && r.quotationMethod === "OCR";
          if (status === "NOT_SENT") return !r.quotationSent;
          return false;
        });
        if (!matches) return false;
      }

      // 9. Multi-Select Party Reply Filter
      if (selectedReplyStatuses.length > 0) {
        const matches = selectedReplyStatuses.some((status) => {
          if (status === "ARRIVED") return r.partyReplyArrived;
          if (status === "AWAITING") return r.partyReplyStatus === "AWAITING_REPLY";
          if (status === "OVERDUE") {
            return r.partyReplyStatus === "AWAITING_REPLY" && r.daysWithoutReply != null && r.daysWithoutReply > 7;
          }
          if (status === "NO_QUOTE") return r.partyReplyStatus === "NO_QUOTE";
          return false;
        });
        if (!matches) return false;
      }

      // 10. Multi-Select File Filter
      if (selectedFilesStatuses.length > 0) {
        const matchesQuoteSent = (selectedFilesStatuses.includes("QUOTE_SENT") || selectedFilesStatuses.includes("SENT")) && r.fileSent;
        const matchesEnquiryDocs = selectedFilesStatuses.includes("ENQUIRY_DOCS") && !r.fileSent && (r.hasEnquiryDocs || r.fileNames.length > 0);
        const matchesNoFiles = selectedFilesStatuses.includes("NO_FILES") && !r.fileSent && !r.hasEnquiryDocs && r.fileNames.length === 0;
        if (!matchesQuoteSent && !matchesEnquiryDocs && !matchesNoFiles) return false;
      }

      // 11. Party Email & Recipients
      if (filterPartyEmail.trim()) {
        const q = filterPartyEmail.toLowerCase();
        const pEmail = (r.partyEmail || "").toLowerCase();
        const toList = (r.allRecipients?.to || []).join(" ").toLowerCase();
        const ccList = (r.allRecipients?.cc || []).join(" ").toLowerCase();
        if (!pEmail.includes(q) && !toList.includes(q) && !ccList.includes(q)) return false;
      }

      // 12. Duration / Last Comm Days Filter
      if (filterDuration === "RECENT") {
        if (r.lastCommunicationDays == null || r.lastCommunicationDays > 3) return false;
      }
      if (filterDuration === "MID") {
        if (r.lastCommunicationDays == null || r.lastCommunicationDays <= 3 || r.lastCommunicationDays > 7) return false;
      }
      if (filterDuration === "OVERDUE") {
        if (r.lastCommunicationDays == null || r.lastCommunicationDays <= 7) return false;
      }

      // 13. Sender / Last Email Filter
      if (filterSender.trim()) {
        const q = filterSender.toLowerCase();
        const sender = (r.latestThread?.sender || "").toLowerCase();
        const subject = (r.latestThread?.subject || "").toLowerCase();
        if (!sender.includes(q) && !subject.includes(q)) return false;
      }

      return true;
    });
  }, [
    rows,
    filterDateFrom,
    filterDateTo,
    filterDocketNo,
    selectedParties,
    selectedStates,
    selectedTypes,
    selectedOrderStatuses,
    selectedActionStatuses,
    selectedQuoteStatuses,
    selectedReplyStatuses,
    selectedFilesStatuses,
    filterPartyEmail,
    filterDuration,
    filterSender,
  ]);

  // Sorting Logic
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === "lastActivity") {
        valA = a.latestThread?.date || "";
        valB = b.latestThread?.date || "";
      } else if (sortField === "quotationSentDate") {
        valA = a.quotationSentDate || "";
        valB = b.quotationSentDate || "";
      } else if (sortField === "lastCommunicationDays") {
        valA = a.lastCommunicationDays ?? 9999;
        valB = b.lastCommunicationDays ?? 9999;
      }

      if (valA == null) return 1;
      if (valB == null) return -1;
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filteredRows, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.ceil(sortedRows.length / pageSize) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedRows.map((r) => r.enquiryId)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const clearAllFilters = () => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDocketNo("");
    setSelectedParties([]);
    setSelectedStates([]);
    setSelectedTypes([]);
    setSelectedOrderStatuses([]);
    setSelectedActionStatuses([]);
    setSelectedQuoteStatuses([]);
    setSelectedReplyStatuses([]);
    setSelectedFilesStatuses([]);
    setFilterPartyEmail("");
    setFilterDuration("ALL");
    setFilterSender("");
    setCurrentPage(1);
  };

  const activeFilterList = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (filterDateFrom || filterDateTo) {
      list.push({
        key: "date",
        label: `Date: ${filterDateFrom || "Any"} to ${filterDateTo || "Now"}`,
        clear: () => {
          setFilterDateFrom("");
          setFilterDateTo("");
        },
      });
    }
    if (filterDocketNo) {
      list.push({
        key: "docket",
        label: `Docket: ${filterDocketNo}`,
        clear: () => setFilterDocketNo(""),
      });
    }
    if (selectedParties.length > 0) {
      list.push({
        key: "party",
        label: `Party (${selectedParties.length}): ${selectedParties.slice(0, 2).join(", ")}${selectedParties.length > 2 ? "..." : ""}`,
        clear: () => setSelectedParties([]),
      });
    }
    if (selectedStates.length > 0) {
      list.push({
        key: "state",
        label: `State (${selectedStates.length}): ${selectedStates.slice(0, 2).join(", ")}${selectedStates.length > 2 ? "..." : ""}`,
        clear: () => setSelectedStates([]),
      });
    }
    if (selectedTypes.length > 0) {
      list.push({
        key: "type",
        label: `Type (${selectedTypes.length}): ${selectedTypes.slice(0, 2).join(", ")}${selectedTypes.length > 2 ? "..." : ""}`,
        clear: () => setSelectedTypes([]),
      });
    }
    if (selectedOrderStatuses.length > 0) {
      list.push({
        key: "orderStatus",
        label: `Order (${selectedOrderStatuses.length}): ${selectedOrderStatuses.slice(0, 2).join(", ")}${selectedOrderStatuses.length > 2 ? "..." : ""}`,
        clear: () => setSelectedOrderStatuses([]),
      });
    }
    if (selectedActionStatuses.length > 0) {
      list.push({
        key: "action",
        label: `Action: ${selectedActionStatuses.map(a => a === "ACTIVE" ? "Email Found" : "Action Pending").join(", ")}`,
        clear: () => setSelectedActionStatuses([]),
      });
    }
    if (selectedQuoteStatuses.length > 0) {
      list.push({
        key: "quote",
        label: `Quote (${selectedQuoteStatuses.length})`,
        clear: () => setSelectedQuoteStatuses([]),
      });
    }
    if (selectedReplyStatuses.length > 0) {
      list.push({
        key: "reply",
        label: `Reply (${selectedReplyStatuses.length})`,
        clear: () => setSelectedReplyStatuses([]),
      });
    }
    if (selectedFilesStatuses.length > 0) {
      list.push({
        key: "files",
        label: `Files (${selectedFilesStatuses.length})`,
        clear: () => setSelectedFilesStatuses([]),
      });
    }
    if (filterPartyEmail) {
      list.push({
        key: "email",
        label: `Email: ${filterPartyEmail}`,
        clear: () => setFilterPartyEmail(""),
      });
    }
    if (filterDuration !== "ALL") {
      list.push({
        key: "duration",
        label: `Duration: ${filterDuration}`,
        clear: () => setFilterDuration("ALL"),
      });
    }
    if (filterSender) {
      list.push({
        key: "sender",
        label: `Sender: ${filterSender}`,
        clear: () => setFilterSender(""),
      });
    }
    return list;
  }, [
    filterDateFrom,
    filterDateTo,
    filterDocketNo,
    selectedParties,
    selectedStates,
    selectedTypes,
    selectedOrderStatuses,
    selectedActionStatuses,
    selectedQuoteStatuses,
    selectedReplyStatuses,
    selectedFilesStatuses,
    filterPartyEmail,
    filterDuration,
    filterSender,
  ]);

  const hasActiveFilters = activeFilterList.length > 0;

  // Export to Excel
  const handleExportExcel = () => {
    const exportData = sortedRows.map((r) => ({
      "Docket No": r.docketNumber,
      "Party Name": r.partyName,
      "Enquiry Date": r.enquiryDate ? r.enquiryDate.slice(0, 10) : "",
      State: r.state || "",
      Utility: r.utility || "",
      "Enquiry Type": r.enquiryType || "",
      "Order Status": r.orderStatus || "",
      "Action Status": r.actionPending ? "Action Pending" : "Email Found",
      "Quotation Sent": r.quotationSent ? "Sent" : "Not Sent",
      "Quotation Method": r.quotationMethod || "",
      "Quotation Sent Date": r.quotationSentDate ? r.quotationSentDate.slice(0, 10) : "",
      "Party Reply Status":
        r.partyReplyStatus === "REPLY_ARRIVED"
          ? "Reply Arrived"
          : r.partyReplyStatus === "AWAITING_REPLY"
          ? "Awaiting Reply"
          : "No Quote Sent",
      "Party Reply Date": r.partyReplyDate ? r.partyReplyDate.slice(0, 10) : "",
      "Party Reply Email": r.partyReplyEmail || "",
      "Last Communication (Days)": r.lastCommunicationDays ?? "",
      "Threads Count": r.threadsCount,
      "Files Dispatched": r.fileSent ? "Yes" : "No",
      "Attachment Names": r.fileNames.join(", "),
      "Party Email": r.partyEmail || "",
      "To Recipients": (r.allRecipients?.to || []).join(", "),
      "Cc Recipients": (r.allRecipients?.cc || []).join(", "),
      "Last Email Date": r.latestThread?.date ? r.latestThread.date.slice(0, 10) : "",
      "Last Email Sender": r.latestThread?.sender || "",
      "Email Subject": r.latestThread?.subject || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Docket Follow Up");
    XLSX.writeFile(wb, `Docket_Follow_Up_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const inputClass =
    "h-6 w-full text-[9px] px-1.5 py-0.5 border border-border rounded bg-background text-foreground outline-none font-normal placeholder:text-muted-foreground/60 focus:border-blue-500";
  const selectClass =
    "h-6 w-full text-[9px] px-1 py-0.5 border border-border rounded bg-background text-foreground outline-none font-normal cursor-pointer focus:border-blue-500";

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden w-full">
      {/* Top Toolbar & Quick Multi-Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-0.5 shrink-0">
        {/* Quick Filter Multi-Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* All */}
          <button
            onClick={() => {
              clearAllFilters();
            }}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border ${
              !hasActiveFilters
                ? "bg-foreground text-background border-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground border-border"
            }`}
          >
            All ({rows.length})
          </button>

          {/* Action Pending */}
          <button
            onClick={() => {
              setSelectedActionStatuses(selectedActionStatuses.includes("PENDING") ? [] : ["PENDING"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedActionStatuses.includes("PENDING")
                ? "bg-rose-600 dark:bg-rose-500/25 text-white dark:text-rose-100 border-rose-600 dark:border-rose-500/40"
                : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 dark:hover:bg-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20"
            }`}
          >
            <AlertCircle className="w-3 h-3" />
            Action Pending ({rows.filter((r) => r.actionPending).length})
          </button>

          {/* Email Found */}
          <button
            onClick={() => {
              setSelectedActionStatuses(selectedActionStatuses.includes("ACTIVE") ? [] : ["ACTIVE"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedActionStatuses.includes("ACTIVE")
                ? "bg-blue-600 dark:bg-blue-500/25 text-white dark:text-blue-100 border-blue-600 dark:border-blue-500/40"
                : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:hover:bg-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20"
            }`}
          >
            <Mail className="w-3 h-3" />
            Email Found ({rows.filter((r) => !r.actionPending).length})
          </button>

          {/* Quote Sent */}
          <button
            onClick={() => {
              setSelectedQuoteStatuses(selectedQuoteStatuses.includes("SENT") ? [] : ["SENT"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedQuoteStatuses.includes("SENT")
                ? "bg-emerald-600 dark:bg-emerald-500/25 text-white dark:text-emerald-100 border-emerald-600 dark:border-emerald-500/40"
                : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20"
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Quote Sent ({rows.filter((r) => r.quotationSent).length})
          </button>

          {/* Quote Not Sent */}
          <button
            onClick={() => {
              setSelectedQuoteStatuses(selectedQuoteStatuses.includes("NOT_SENT") ? [] : ["NOT_SENT"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedQuoteStatuses.includes("NOT_SENT")
                ? "bg-amber-600 dark:bg-amber-500/25 text-white dark:text-amber-100 border-amber-600 dark:border-amber-500/40"
                : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20"
            }`}
          >
            <Clock className="w-3 h-3" />
            Not Sent ({rows.filter((r) => !r.quotationSent).length})
          </button>

          {/* Reply Arrived */}
          <button
            onClick={() => {
              setSelectedReplyStatuses(selectedReplyStatuses.includes("ARRIVED") ? [] : ["ARRIVED"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedReplyStatuses.includes("ARRIVED")
                ? "bg-indigo-600 dark:bg-indigo-500/25 text-white dark:text-indigo-100 border-indigo-600 dark:border-indigo-500/40"
                : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20"
            }`}
          >
            <Send className="w-3 h-3" />
            Reply Arrived ({rows.filter((r) => r.partyReplyStatus === "REPLY_ARRIVED").length})
          </button>

          {/* Awaiting Reply */}
          <button
            onClick={() => {
              setSelectedReplyStatuses(selectedReplyStatuses.includes("AWAITING") ? [] : ["AWAITING"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedReplyStatuses.includes("AWAITING")
                ? "bg-amber-600 dark:bg-amber-500/25 text-white dark:text-amber-100 border-amber-600 dark:border-amber-500/40"
                : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20"
            }`}
          >
            <Clock className="w-3 h-3" />
            Awaiting ({rows.filter((r) => r.partyReplyStatus === "AWAITING_REPLY").length})
          </button>

          {/* Overdue > 7 Days */}
          <button
            onClick={() => {
              setSelectedReplyStatuses(selectedReplyStatuses.includes("OVERDUE") ? [] : ["OVERDUE"]);
              setCurrentPage(1);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer border flex items-center gap-1 ${
              selectedReplyStatuses.includes("OVERDUE")
                ? "bg-red-600 dark:bg-red-500/25 text-white dark:text-red-100 border-red-600 dark:border-red-500/40"
                : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:hover:bg-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20"
            }`}
          >
            <AlertCircle className="w-3 h-3" />
            Overdue &gt;7d ({rows.filter((r) => r.partyReplyStatus === "AWAITING_REPLY" && r.daysWithoutReply != null && r.daysWithoutReply > 7).length})
          </button>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Advanced Filters Drawer */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`h-7 px-2.5 text-xs font-semibold cursor-pointer ${
              showAdvancedFilters || hasActiveFilters
                ? "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/12 dark:text-blue-300 dark:border-blue-500/25"
                : ""
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
            Multiple Filters {hasActiveFilters ? `(${activeFilterList.length})` : ""}
          </Button>

          {/* Export Excel */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="h-7 px-2.5 text-xs font-semibold bg-sky-50 hover:bg-sky-100 dark:hover:bg-sky-500/20 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/25 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Advanced Multiple Filter Panel (Collapsible / Expandable) */}
      {showAdvancedFilters && (
        <div className="p-3 bg-muted/30 rounded-lg border border-border space-y-2.5 shrink-0 text-xs transition-all">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <span className="font-bold text-foreground flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
              Multiple Filter Criteria (Click to select multiple options)
            </span>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 dark:hover:text-rose-200 dark:text-rose-300 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Clear All Filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-2.5">
            {/* Party Name Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Party Name ({uniqueParties.length})
              </label>
              <MultiFilterDropdown
                label="All Parties"
                options={partyOptions}
                selectedValues={selectedParties}
                onChange={(vals) => {
                  setSelectedParties(vals);
                  setCurrentPage(1);
                }}
                showSearch={true}
                placeholder="Search party..."
              />
            </div>

            {/* State Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                State ({uniqueStates.length})
              </label>
              <MultiFilterDropdown
                label="All States"
                options={stateOptions}
                selectedValues={selectedStates}
                onChange={(vals) => {
                  setSelectedStates(vals);
                  setCurrentPage(1);
                }}
                showSearch={true}
                placeholder="Search state..."
              />
            </div>

            {/* Enquiry Type Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Enquiry Type ({uniqueTypes.length})
              </label>
              <MultiFilterDropdown
                label="All Types"
                options={typeOptions}
                selectedValues={selectedTypes}
                onChange={(vals) => {
                  setSelectedTypes(vals);
                  setCurrentPage(1);
                }}
                showSearch={uniqueTypes.length > 5}
                placeholder="Search type..."
              />
            </div>

            {/* Order Status Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Order Status ({uniqueOrderStatuses.length})
              </label>
              <MultiFilterDropdown
                label="All Statuses"
                options={orderStatusOptions}
                selectedValues={selectedOrderStatuses}
                onChange={(vals) => {
                  setSelectedOrderStatuses(vals);
                  setCurrentPage(1);
                }}
                showSearch={uniqueOrderStatuses.length > 5}
                placeholder="Search order status..."
              />
            </div>

            {/* Quote Status Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Quote Status
              </label>
              <MultiFilterDropdown
                label="All Quote Status"
                options={quoteStatusOptions}
                selectedValues={selectedQuoteStatuses}
                onChange={(vals) => {
                  setSelectedQuoteStatuses(vals);
                  setCurrentPage(1);
                }}
                showSearch={false}
              />
            </div>

            {/* Party Reply Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Party Reply
              </label>
              <MultiFilterDropdown
                label="All Replies"
                options={partyReplyOptions}
                selectedValues={selectedReplyStatuses}
                onChange={(vals) => {
                  setSelectedReplyStatuses(vals);
                  setCurrentPage(1);
                }}
                showSearch={false}
              />
            </div>

            {/* Action Status Multi-Filter */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Action Status
              </label>
              <MultiFilterDropdown
                label="All Statuses"
                options={actionStatusOptions}
                selectedValues={selectedActionStatuses}
                onChange={(vals) => {
                  setSelectedActionStatuses(vals);
                  setCurrentPage(1);
                }}
                showSearch={false}
              />
            </div>

            {/* Turnaround Duration */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">
                Last Activity
              </label>
              <select
                value={filterDuration}
                onChange={(e) => {
                  setFilterDuration(e.target.value);
                  setCurrentPage(1);
                }}
                className={selectClass}
              >
                <option value="ALL">All Durations</option>
                <option value="RECENT">&le; 3 Days ago</option>
                <option value="MID">3 - 7 Days ago</option>
                <option value="OVERDUE">&gt; 7 Days ago</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Active Filter Chips / Pills Display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 py-1 px-1 shrink-0">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1">
            Active Filters ({filteredRows.length} matches):
          </span>
          {activeFilterList.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25 shadow-2xs"
            >
              <span>{f.label}</span>
              <button
                onClick={f.clear}
                className="hover:bg-blue-200 dark:hover:bg-blue-500/20 rounded-full p-0.5 cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-[10.5px] font-semibold text-rose-600 dark:text-rose-300 hover:underline ml-1 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Main Table Styled Exactly Like EnquiryTable */}
      <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-card overflow-hidden shadow-xs">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            {/* Table Header with In-Header Column Filters */}
            <thead className="sticky top-0 z-30 bg-muted/95 backdrop-blur-xs">
              <tr>
                {/* 0. Checkbox SEL */}
                <th className="py-2 px-2 text-center border-r border-b border-border w-[40px] select-none">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <span className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
                      Sel
                    </span>
                    <input
                      type="checkbox"
                      checked={
                        paginatedRows.length > 0 && selectedIds.size === paginatedRows.length
                      }
                      onChange={handleSelectAll}
                      className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                    />
                  </div>
                </th>

                {/* 1. Enquiry Date */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[130px]">
                  <div
                    onClick={() => toggleSort("enquiryDate")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Enquiry Date</span>
                    {sortField === "enquiryDate" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="flex gap-1 items-center mt-1.5">
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => {
                        setFilterDateFrom(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={inputClass}
                    />
                    <span className="text-[9px] text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => {
                        setFilterDateTo(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={inputClass}
                    />
                  </div>
                </th>

                {/* 2. Docket No */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[125px]">
                  <div
                    onClick={() => toggleSort("docketNumber")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Docket No</span>
                    {sortField === "docketNumber" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <input
                      type="text"
                      placeholder="Search..."
                      value={filterDocketNo}
                      onChange={(e) => {
                        setFilterDocketNo(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={inputClass}
                    />
                  </div>
                </th>

                {/* 3. Party Name */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[180px]">
                  <div
                    onClick={() => toggleSort("partyName")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Party Name</span>
                    {sortField === "partyName" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All Parties"
                      options={partyOptions}
                      selectedValues={selectedParties}
                      onChange={(vals) => {
                        setSelectedParties(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={true}
                      placeholder="Search party..."
                    />
                  </div>
                </th>

                {/* 4. State & Type (NEW) */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[120px]">
                  <div
                    onClick={() => toggleSort("state")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>State / Type</span>
                    {sortField === "state" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All States"
                      options={stateOptions}
                      selectedValues={selectedStates}
                      onChange={(vals) => {
                        setSelectedStates(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={true}
                      placeholder="Search state..."
                    />
                  </div>
                </th>

                {/* 5. Action Status */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[125px]">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    <span>Action Status</span>
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All Statuses"
                      options={actionStatusOptions}
                      selectedValues={selectedActionStatuses}
                      onChange={(vals) => {
                        setSelectedActionStatuses(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={false}
                    />
                  </div>
                </th>

                {/* 6. Quotation Sent & Date */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[140px]">
                  <div
                    onClick={() => toggleSort("quotationSentDate")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Quote Sent / Date</span>
                    {sortField === "quotationSentDate" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All Quote Status"
                      options={quoteStatusOptions}
                      selectedValues={selectedQuoteStatuses}
                      onChange={(vals) => {
                        setSelectedQuoteStatuses(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={false}
                    />
                  </div>
                </th>

                {/* 7. Party Reply Arrived */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[135px]">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    <span>Party Reply</span>
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All Replies"
                      options={partyReplyOptions}
                      selectedValues={selectedReplyStatuses}
                      onChange={(vals) => {
                        setSelectedReplyStatuses(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={false}
                    />
                  </div>
                </th>

                {/* 8. Files Sent */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[130px]">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    <span>Attachments / Files</span>
                  </div>
                  <div className="mt-1.5">
                    <MultiFilterDropdown
                      label="All Files"
                      options={fileOptions}
                      selectedValues={selectedFilesStatuses}
                      onChange={(vals) => {
                        setSelectedFilesStatuses(vals);
                        setCurrentPage(1);
                      }}
                      showSearch={false}
                    />
                  </div>
                </th>

                {/* 9. Party Email */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[160px]">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    <span>Party Email</span>
                  </div>
                  <div className="mt-1.5">
                    <input
                      type="text"
                      placeholder="Search email..."
                      value={filterPartyEmail}
                      onChange={(e) => {
                        setFilterPartyEmail(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={inputClass}
                    />
                  </div>
                </th>

                {/* 10. Last Communication Days */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[125px]">
                  <div
                    onClick={() => toggleSort("lastCommunicationDays")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Last Comm.</span>
                    {sortField === "lastCommunicationDays" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <select
                      value={filterDuration}
                      onChange={(e) => {
                        setFilterDuration(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={selectClass}
                    >
                      <option value="ALL">All Days</option>
                      <option value="RECENT">&le; 3 Days</option>
                      <option value="MID">3 - 7 Days</option>
                      <option value="OVERDUE">&gt; 7 Days</option>
                    </select>
                  </div>
                </th>

                {/* 11. Last Activity / Sender */}
                <th className="py-2 px-2.5 border-r border-b border-border min-w-[140px]">
                  <div
                    onClick={() => toggleSort("lastActivity")}
                    className="flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  >
                    <span>Last Activity</span>
                    {sortField === "lastActivity" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                  <div className="mt-1.5">
                    <input
                      type="text"
                      placeholder="Sender / Subject..."
                      value={filterSender}
                      onChange={(e) => {
                        setFilterSender(e.target.value);
                        setCurrentPage(1);
                      }}
                      className={inputClass}
                    />
                  </div>
                </th>

                {/* 12. Actions Column */}
                <th className="sticky right-0 z-30 bg-muted/95 backdrop-blur-xs py-2 px-2.5 text-center border-b border-l border-border w-[70px] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    Action
                  </div>
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-border/60">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-16 text-center text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                    No dockets match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r) => {
                  const thread = r.latestThread;
                  const attachLinks = r.attachLinks || {};
                  const initials = getPartyInitials(r.partyName);
                  const avatarColor = getAvatarColor(initials);
                  const isSelected = selectedIds.has(r.enquiryId);

                  const rowBg = r.actionPending
                    ? "bg-[#fee2e2]/50 hover:bg-[#fee2e2]/70 dark:bg-red-500/8 dark:hover:bg-red-500/10"
                    : isSelected
                    ? "bg-blue-50/70 hover:bg-blue-50 dark:hover:bg-blue-500/20 dark:bg-blue-500/10"
                    : "hover:bg-muted/40";

                  return (
                    <tr key={r.enquiryId} className={`transition-colors text-xs ${rowBg}`}>
                      {/* Checkbox */}
                      <td className="py-2.5 px-2 text-center border-r border-b border-border select-none">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(r.enquiryId)}
                          className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                        />
                      </td>

                      {/* Enquiry Date */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap text-muted-foreground">
                        {r.enquiryDate ? (
                          new Date(r.enquiryDate).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Docket No */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap font-bold text-[#0353e9] dark:text-primary hover:underline cursor-pointer">
                        <span onClick={() => setSelectedRow(r)}>{r.docketNumber}</span>
                      </td>

                      {/* Party Name with Initial Avatar Badge */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[9px] shrink-0 ${avatarColor}`}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div
                              className="font-bold text-foreground text-[11px] truncate max-w-[190px]"
                              title={r.partyName}
                            >
                              {r.partyName}
                            </div>
                            {r.orderStatus && (
                              <span className="text-[9.5px] px-1 py-0.2 rounded font-mono font-medium bg-muted text-muted-foreground border border-border">
                                {r.orderStatus}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* State & Type */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground text-[11px]">
                            {r.state || "—"}
                          </span>
                          <div className="flex items-center gap-1">
                            {r.enquiryType && (
                              <span className="text-[9px] px-1 rounded font-semibold bg-muted text-muted-foreground border border-border">
                                {r.enquiryType}
                              </span>
                            )}
                            {r.utility && (
                              <span className="text-[9px] text-muted-foreground">
                                {r.utility}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Action Status Badge */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        {r.actionPending ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300 border border-rose-300/60 dark:border-rose-500/25">
                            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-300 shrink-0" />
                            Action Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-500/25">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-300 shrink-0" />
                            Email Found ({r.threadsCount})
                          </span>
                        )}
                      </td>

                      {/* Quotation Sent & Date */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        {r.quotationSent ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300 shrink-0" />
                                Quote Sent
                              </span>
                              {r.quotationMethod && (
                                <span
                                  className="text-[9px] px-1 py-0.2 rounded font-medium bg-muted text-muted-foreground border border-border"
                                  title={`Quotation detected via ${r.quotationMethod === "OCR" ? "OCR scan text" : "attachment filename"}`}
                                >
                                  {r.quotationMethod}
                                </span>
                              )}
                            </div>
                            {r.quotationSentDate && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-normal">
                                <Calendar className="w-2.5 h-2.5 opacity-70" />
                                {new Date(r.quotationSentDate).toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground font-normal">
                            Not Sent
                          </span>
                        )}
                      </td>

                      {/* Party Reply Arrived */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        {r.partyReplyStatus === "REPLY_ARRIVED" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300 shrink-0" />
                              Reply Arrived
                            </span>
                            {r.partyReplyDate && (
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(r.partyReplyDate).toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                            )}
                            {r.partyReplyEmail && (
                              <span
                                className="text-[9px] text-muted-foreground font-mono truncate max-w-[130px]"
                                title={r.partyReplyEmail}
                              >
                                {r.partyReplyEmail}
                              </span>
                            )}
                          </div>
                        ) : r.partyReplyStatus === "AWAITING_REPLY" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0" />
                              Awaiting Reply
                            </span>
                            {r.daysWithoutReply != null && (
                              <span
                                className={`text-[10px] font-medium ${
                                  r.daysWithoutReply > 7
                                    ? "text-rose-600 dark:text-rose-300 font-bold"
                                    : "text-amber-700 dark:text-amber-300"
                                }`}
                              >
                                {r.daysWithoutReply === 0 ? "Sent today" : `${r.daysWithoutReply}d without reply`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">—</span>
                        )}
                      </td>

                      {/* Attachments / Files */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        {r.fileSent && r.fileNames.length > 0 ? (
                          /* Blue — quotation files were sent via email */
                          <div className="flex items-center gap-1.5">
                            {r.fileNames.length === 1 ? (
                              (() => {
                                const fn = r.fileNames[0];
                                const link = attachLinks[fn] || (r.attachLinks && r.attachLinks[fn]);
                                return link ? (
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:underline border border-blue-200 dark:border-blue-500/25 transition-colors cursor-pointer"
                                    title={fn}
                                  >
                                    <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-300 shrink-0" />
                                    <span className="truncate max-w-[130px]">{fn}</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                                  </a>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-muted text-foreground border border-border"
                                    title={fn}
                                  >
                                    <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-300 shrink-0" />
                                    <span className="truncate max-w-[130px]">{fn}</span>
                                  </span>
                                );
                              })()
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedRow(r)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 hover:bg-blue-100 dark:hover:bg-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25 transition-colors cursor-pointer"
                                title="Click to view all attachments"
                              >
                                <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-300 shrink-0" />
                                <span>{r.fileNames.length} Files ↗</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                              </button>
                            )}
                          </div>
                        ) : !r.fileSent && r.fileNames.length > 0 ? (
                          /* Amber — portal enquiry spec docs (no quotation sent yet) */
                          <div className="flex items-center gap-1.5">
                            {r.fileNames.length === 1 ? (
                              (() => {
                                const fn = r.fileNames[0];
                                const link = r.attachLinks && r.attachLinks[fn];
                                return link ? (
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 hover:underline border border-amber-200 dark:border-amber-500/25 transition-colors cursor-pointer"
                                    title={fn}
                                  >
                                    <FileText className="w-3 h-3 text-amber-600 dark:text-amber-300 shrink-0" />
                                    <span className="truncate max-w-[130px]">Spec Doc</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                                  </a>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/25"
                                    title={fn}
                                  >
                                    <FileText className="w-3 h-3 text-amber-600 dark:text-amber-300 shrink-0" />
                                    <span className="truncate max-w-[130px]">Spec Doc</span>
                                  </span>
                                );
                              })()
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedRow(r)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 hover:bg-amber-100 dark:hover:bg-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-amber-500/25 transition-colors cursor-pointer"
                                title="Click to view spec documents"
                              >
                                <FileText className="w-3 h-3 text-amber-600 dark:text-amber-300 shrink-0" />
                                <span>{r.fileNames.length} Spec Docs ↗</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60 text-[11px]">No Files</span>
                        )}
                      </td>

                      {/* Party Email */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap">
                        {r.partyEmail ? (
                          <span
                            className="text-blue-700 dark:text-blue-300 font-mono text-[10.5px] truncate max-w-[150px] block"
                            title={r.partyEmail}
                          >
                            {r.partyEmail}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Last Communication (Days) */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border whitespace-nowrap text-center">
                        {r.lastCommunicationDays != null ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-mono font-bold text-[10.5px] ${
                              r.lastCommunicationDays <= 3
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : r.lastCommunicationDays <= 7
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                            }`}
                          >
                            {r.lastCommunicationDays === 0
                              ? "Today"
                              : `${r.lastCommunicationDays}d ago`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Last Activity / Sender */}
                      <td className="py-2.5 px-2.5 border-r border-b border-border">
                        {thread ? (
                          <div className="space-y-0.5">
                            <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]" title={thread.sender || ""}>
                              {thread.sender || "Unknown"}
                            </div>
                            <div className="text-[11px] text-foreground font-medium truncate max-w-[140px]" title={thread.subject || ""}>
                              {thread.subject || "(No Subject)"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Action View Button */}
                      <td className="sticky right-0 z-20 bg-background/95 backdrop-blur-xs py-2 px-2.5 text-center border-b border-l border-border shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedRow(r)}
                          className="h-7 w-7 p-0 rounded-md hover:bg-blue-50 text-blue-600 dark:hover:bg-blue-500/12 dark:text-blue-300 cursor-pointer"
                          title="View 3-Stage Lifecycle Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="text-muted-foreground font-medium">
            Showing <span className="font-bold text-foreground">{sortedRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}</span> to{" "}
            <span className="font-bold text-foreground">
              {Math.min(currentPage * pageSize, sortedRows.length)}
            </span>{" "}
            of <span className="font-bold text-foreground">{sortedRows.length}</span> filtered enquiries
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-[11px]">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-6 text-xs px-1.5 py-0.5 border border-border rounded bg-background text-foreground outline-none cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-6 px-2 text-xs font-semibold cursor-pointer"
              >
                Previous
              </Button>
              <span className="px-2 font-mono text-[11px] text-muted-foreground font-semibold">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-6 px-2 text-xs font-semibold cursor-pointer"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Stage Lifecycle Detail Modal */}
      <ThreadDetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        row={selectedRow}
      />
    </div>
  );
}
