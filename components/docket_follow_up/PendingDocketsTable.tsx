"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  RotateCcw,
  Download,
  AlertCircle,
  FileText,
  Paperclip,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Clock,
  Send,
  User,
  CheckCircle2,
  X,
  FileSpreadsheet,
  FileCode,
  Calendar,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiFilterDropdown, FilterOption } from "./MultiFilterDropdown";

export interface PendingDocketRow {
  id: number;
  threadId: string;
  date: string | null;
  subject: string;
  tenderTag: string | null;
  requester: {
    name: string;
    email: string;
    isInternal: boolean;
  };
  mailType: string;
  docketNo: string | null;
  docketStatus: string | null;
  msgCount: number;
  hasLaserReply: boolean;
  laserReplySnippet: string | null;
  pendingStatus: "PENDING_DOCKET" | "DOCKET_STAMPED_NO_REPLY" | "RESOLVED";
  requestSnippet: string;
  attachNames: string[];
  attachLinks: Record<string, string>;
  toRecipients: string[];
  ccRecipients: string[];
  messages: Array<{
    num: number;
    sender: string;
    body: string;
  }>;
}

interface PendingDocketsTableProps {
  rows: PendingDocketRow[];
  loading?: boolean;
}

function getRequesterInitials(name: string): string {
  if (!name) return "EQ";
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return "EQ";
}

function getAvatarBg(name: string): string {
  const code = (name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0);
  const colors = [
    "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800",
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800",
    "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800",
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
  ];
  return colors[code % colors.length];
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const now = Date.now();
  const d = new Date(dateStr).getTime();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  return `${months}mo ago`;
}

export default function PendingDocketsTable({ rows, loading = false }: PendingDocketsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRequesters, setSelectedRequesters] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [filterHasAttach, setFilterHasAttach] = useState<"ALL" | "YES" | "NO">("ALL");
  const [filterMailType, setFilterMailType] = useState<string>("ALL");

  // Sorting
  const [sortField, setSortField] = useState<string>("date");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selected thread modal
  const [selectedThread, setSelectedThread] = useState<PendingDocketRow | null>(null);

  // Unique Dropdown Options
  const uniqueRequesters = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.requester.name) set.add(r.requester.name);
    });
    return Array.from(set).sort();
  }, [rows]);

  const requesterOptions: FilterOption[] = useMemo(() => {
    return uniqueRequesters.map((name) => ({
      value: name,
      label: name,
      count: rows.filter((r) => r.requester.name === name).length,
    }));
  }, [uniqueRequesters, rows]);

  const statusOptions: FilterOption[] = useMemo(
    () => [
      {
        value: "PENDING_DOCKET",
        label: "No Docket Assigned",
        count: rows.filter((r) => r.pendingStatus === "PENDING_DOCKET").length,
      },
      {
        value: "DOCKET_STAMPED",
        label: "Docket Stamped in DB",
        count: rows.filter((r) => r.pendingStatus === "DOCKET_STAMPED").length,
      },
    ],
    [rows]
  );

  // Quick Filter Counts for Pills
  const totalCount = rows.length;
  const noDocketCount = rows.filter((r) => r.pendingStatus === "PENDING_DOCKET").length;
  const withAttachCount = rows.filter((r) => r.attachNames.length > 0).length;

  // Filtered Rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // 1. Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const sMatch = r.subject.toLowerCase().includes(q);
        const reqMatch = `${r.requester.name} ${r.requester.email}`.toLowerCase().includes(q);
        const snipMatch = r.requestSnippet.toLowerCase().includes(q);
        const tenderMatch = r.tenderTag?.toLowerCase().includes(q);
        const docMatch = r.docketNo?.toLowerCase().includes(q);
        const attMatch = r.attachNames.some((n) => n.toLowerCase().includes(q));
        if (!sMatch && !reqMatch && !snipMatch && !tenderMatch && !docMatch && !attMatch) {
          return false;
        }
      }

      // 2. Requester Filter
      if (selectedRequesters.length > 0) {
        if (!selectedRequesters.includes(r.requester.name)) return false;
      }

      // 3. Status Filter
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(r.pendingStatus)) return false;
      }

      // 4. Attachments Filter
      if (filterHasAttach === "YES" && r.attachNames.length === 0) return false;
      if (filterHasAttach === "NO" && r.attachNames.length > 0) return false;

      // 5. Mail Type Filter
      if (filterMailType !== "ALL") {
        if (r.mailType !== filterMailType) return false;
      }

      return true;
    });
  }, [rows, searchQuery, selectedRequesters, selectedStatuses, filterHasAttach, filterMailType]);

  // Sorted Rows
  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      let valA: any = a.date ? new Date(a.date).getTime() : 0;
      let valB: any = b.date ? new Date(b.date).getTime() : 0;

      if (sortField === "requester") {
        valA = a.requester.name.toLowerCase();
        valB = b.requester.name.toLowerCase();
      } else if (sortField === "subject") {
        valA = a.subject.toLowerCase();
        valB = b.subject.toLowerCase();
      } else if (sortField === "msgCount") {
        valA = a.msgCount;
        valB = b.msgCount;
      } else if (sortField === "attachments") {
        valA = a.attachNames.length;
        valB = b.attachNames.length;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredRows, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  function toggleSort(field: string) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  function clearAllFilters() {
    setSearchQuery("");
    setSelectedRequesters([]);
    setSelectedStatuses([]);
    setFilterHasAttach("ALL");
    setFilterMailType("ALL");
    setCurrentPage(1);
  }

  const hasActiveFilters =
    Boolean(searchQuery) ||
    selectedRequesters.length > 0 ||
    selectedStatuses.length > 0 ||
    filterHasAttach !== "ALL" ||
    filterMailType !== "ALL";

  function handleExportCsv() {
    if (sortedRows.length === 0) return;
    const headers = [
      "Date",
      "Requester Name",
      "Requester Email",
      "Subject",
      "Tender / GeM Ref",
      "Mail Type",
      "Docket in DB",
      "Msg Count",
      "Status",
      "Attachments",
      "Snippet",
    ];

    const csvData = sortedRows.map((r) => [
      r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
      `"${r.requester.name.replace(/"/g, '""')}"`,
      `"${r.requester.email.replace(/"/g, '""')}"`,
      `"${r.subject.replace(/"/g, '""')}"`,
      `"${(r.tenderTag || "").replace(/"/g, '""')}"`,
      r.mailType,
      r.docketNo || "",
      r.msgCount,
      r.pendingStatus,
      `"${r.attachNames.join("; ").replace(/"/g, '""')}"`,
      `"${r.requestSnippet.replace(/"/g, '""').replace(/\n/g, " ")}"`,
    ]);

    const csvContent = [headers.join(","), ...csvData.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Pending_Dockets_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-card rounded-lg border border-border overflow-hidden shadow-2xs">
      {/* Top Filter & Action Bar */}
      <div className="p-3 bg-muted/25 border-b border-border space-y-2.5 shrink-0">
        {/* Row 1: Search & Quick Filter Pills */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px] max-w-md w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by subject, tender, requester, snippet..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background rounded-md border border-border focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                clearAllFilters();
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                !hasActiveFilters
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All Requests ({totalCount})
            </button>

            <button
              onClick={() => {
                clearAllFilters();
                setSelectedStatuses(["PENDING_DOCKET"]);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer border ${
                selectedStatuses.includes("PENDING_DOCKET") && selectedStatuses.length === 1
                  ? "bg-rose-600 text-white border-rose-600"
                  : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900"
              }`}
            >
              <AlertCircle className="w-3 h-3 inline mr-1" />
              No Docket Assigned ({noDocketCount})
            </button>

            <button
              onClick={() => {
                setFilterHasAttach(filterHasAttach === "YES" ? "ALL" : "YES");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer border ${
                filterHasAttach === "YES"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
              }`}
            >
              <Paperclip className="w-3 h-3 inline mr-1" />
              Has Files ({withAttachCount})
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="px-2 py-1 text-[11px] font-medium text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="h-7 px-2.5 text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800 cursor-pointer ml-auto"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Row 2: Secondary Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
          {/* Requester Filter */}
          <div className="w-[180px]">
            <MultiFilterDropdown
              label="All Requesters"
              options={requesterOptions}
              selectedValues={selectedRequesters}
              onChange={(vals: string[]) => {
                setSelectedRequesters(vals);
                setCurrentPage(1);
              }}
              showSearch={true}
              placeholder="Search requester..."
            />
          </div>

          {/* Status Filter */}
          <div className="w-[200px]">
            <MultiFilterDropdown
              label="All Statuses"
              options={statusOptions}
              selectedValues={selectedStatuses}
              onChange={(vals: string[]) => {
                setSelectedStatuses(vals);
                setCurrentPage(1);
              }}
              showSearch={false}
            />
          </div>

          {/* Mail Type Selector */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-[11px] font-medium text-muted-foreground">Type:</span>
            <select
              value={filterMailType}
              onChange={(e) => {
                setFilterMailType(e.target.value);
                setCurrentPage(1);
              }}
              className="h-7 px-2 text-xs bg-background rounded-md border border-border focus:outline-hidden"
            >
              <option value="ALL">All Types</option>
              <option value="DOCKET">DOCKET</option>
              <option value="QUOTATION">QUOTATION</option>
              <option value="BOTH">BOTH</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground ml-auto font-medium">
            Showing <span className="font-bold text-foreground">{sortedRows.length}</span> of {rows.length} pending requests
          </div>
        </div>
      </div>

      {/* Main Table View */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left border-collapse border-spacing-0">
          <thead className="bg-muted/80 backdrop-blur-xs sticky top-0 z-20 border-b border-border select-none shadow-2xs">
            <tr>
              {/* 1. Date */}
              <th
                onClick={() => toggleSort("date")}
                className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap min-w-[120px]"
              >
                <div className="flex items-center gap-1">
                  <span>Date & Age</span>
                  {sortField === "date" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>

              {/* 2. Requester */}
              <th
                onClick={() => toggleSort("requester")}
                className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap min-w-[180px]"
              >
                <div className="flex items-center gap-1">
                  <span>Requester / Sender</span>
                  {sortField === "requester" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>

              {/* 3. Subject & Tender */}
              <th
                onClick={() => toggleSort("subject")}
                className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground min-w-[260px]"
              >
                <div className="flex items-center gap-1">
                  <span>Subject & Reference</span>
                  {sortField === "subject" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>

              {/* 4. Conversation Snippet */}
              <th className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[300px]">
                <span>Request Message Snippet</span>
              </th>

              {/* 5. Attachments */}
              <th
                onClick={() => toggleSort("attachments")}
                className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground min-w-[160px]"
              >
                <div className="flex items-center gap-1">
                  <span>Attachments</span>
                  {sortField === "attachments" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>

              {/* 6. Status */}
              <th className="py-2.5 px-3 border-r border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[150px]">
                <span>Status & Docket</span>
              </th>

              {/* 7. Action */}
              <th className="sticky right-0 z-20 bg-muted/95 backdrop-blur-xs py-2.5 px-3 text-center border-l border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-[90px] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">
                <span>Action</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/60">
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-sm font-medium">No pending docket requests match your filters.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Try clearing filters or adjusting your search query.</p>
                </td>
              </tr>
            ) : (
              paginatedRows.map((r) => {
                const initials = getRequesterInitials(r.requester.name);
                const avatarClass = getAvatarBg(r.requester.name);

                return (
                  <tr key={r.id} className="hover:bg-muted/40 transition-colors text-xs">
                    {/* 1. Date */}
                    <td className="py-2.5 px-3 border-r border-b border-border whitespace-nowrap align-top">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-foreground">
                          {r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A"}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5 opacity-70" />
                          <span>{formatRelativeTime(r.date)}</span>
                        </div>
                      </div>
                    </td>

                    {/* 2. Requester */}
                    <td className="py-2.5 px-3 border-r border-b border-border align-top">
                      <div className="flex items-start gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border ${avatarClass}`}>
                          {initials}
                        </div>
                        <div className="min-w-0 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground truncate max-w-[140px]" title={r.requester.name}>
                              {r.requester.name}
                            </span>
                            {r.requester.isInternal ? (
                              <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200">
                                Team
                              </span>
                            ) : (
                              <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200">
                                Client
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]" title={r.requester.email}>
                            {r.requester.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 3. Subject & Tender */}
                    <td className="py-2.5 px-3 border-r border-b border-border align-top">
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-foreground line-clamp-2 leading-relaxed" title={r.subject}>
                          {r.subject}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {r.tenderTag && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/60">
                              {r.tenderTag}
                            </span>
                          )}
                          <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-muted text-muted-foreground border border-border">
                            {r.mailType}
                          </span>
                          {r.msgCount > 1 && (
                            <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {r.msgCount} msgs
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 4. Conversation Snippet */}
                    <td className="py-2.5 px-3 border-r border-b border-border align-top">
                      <div className="text-[11px] text-muted-foreground line-clamp-3 leading-relaxed bg-muted/30 p-2 rounded border border-border/50 font-sans">
                        {r.requestSnippet || "No text content preview available."}
                      </div>
                    </td>

                    {/* 5. Attachments */}
                    <td className="py-2.5 px-3 border-r border-b border-border align-top">
                      {r.attachNames.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground italic">No files attached</span>
                      ) : (
                        <div className="flex flex-col gap-1 max-w-[200px]">
                          {r.attachNames.slice(0, 3).map((name, idx) => {
                            const link = r.attachLinks[name];
                            const isPdf = name.toLowerCase().endsWith(".pdf");
                            const isExcel = name.toLowerCase().endsWith(".xlsx") || name.toLowerCase().endsWith(".xls");

                            return (
                              <div
                                key={idx}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/70 hover:bg-muted border border-border/80 text-[10px] text-foreground truncate transition-colors"
                              >
                                {isPdf ? (
                                  <FileText className="w-3 h-3 text-rose-500 shrink-0" />
                                ) : isExcel ? (
                                  <FileSpreadsheet className="w-3 h-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <Paperclip className="w-3 h-3 text-blue-500 shrink-0" />
                                )}
                                <span className="truncate flex-1 font-medium" title={name}>
                                  {name}
                                </span>
                                {link && (
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 p-0.5 shrink-0 cursor-pointer"
                                    title="Open / Download attachment"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </div>
                            );
                          })}
                          {r.attachNames.length > 3 && (
                            <span className="text-[10px] text-muted-foreground font-semibold px-1">
                              +{r.attachNames.length - 3} more files
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 6. Status */}
                    <td className="py-2.5 px-3 border-r border-b border-border whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1">
                        {r.pendingStatus === "PENDING_DOCKET" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300/60">
                            <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                            No Docket Assigned
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300/60">
                              <CheckCircle2 className="w-3 h-3 text-blue-600 shrink-0" />
                              Docket in DB
                            </span>
                            {r.docketNo && (
                              <span className="text-[10px] font-bold font-mono text-foreground px-1 truncate max-w-[140px]" title={r.docketNo}>
                                {r.docketNo}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* 7. Action */}
                    <td className="sticky right-0 z-10 bg-card py-2.5 px-3 text-center border-b border-l border-border align-middle shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedThread(r)}
                        className="h-7 px-2 text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 cursor-pointer w-full"
                      >
                        <Eye className="w-3 h-3 mr-1 shrink-0" />
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-2.5 px-4 bg-muted/20 border-t border-border flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-6 px-1.5 text-xs bg-background rounded border border-border focus:outline-hidden"
          >
            <option value={15}>15</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            Page <span className="font-semibold text-foreground">{currentPage}</span> of{" "}
            <span className="font-semibold text-foreground">{totalPages}</span>
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="h-6 w-6 p-0 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="h-6 w-6 p-0 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Full Conversation & Attachment Inspection Modal */}
      {selectedThread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-card w-full max-w-4xl max-h-[90vh] rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-muted/40 border-b border-border flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground truncate max-w-xl">
                    {selectedThread.subject}
                  </h3>
                  {selectedThread.tenderTag && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/60 shrink-0">
                      {selectedThread.tenderTag}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>From: <strong className="text-foreground">{selectedThread.requester.name}</strong> ({selectedThread.requester.email})</span>
                  <span>&bull;</span>
                  <span>Date: {selectedThread.date ? new Date(selectedThread.date).toLocaleString("en-IN") : "N/A"}</span>
                </div>
              </div>

              <button
                onClick={() => setSelectedThread(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer shrink-0 ml-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
              {/* Info Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-muted/30 border border-border text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground block font-semibold uppercase">Docket in DB</span>
                  <span className="font-bold text-foreground font-mono">{selectedThread.docketNo || "None (Pending)"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-semibold uppercase">Mail Type</span>
                  <span className="font-semibold text-foreground">{selectedThread.mailType}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-semibold uppercase">Laserentry Reply</span>
                  <span className={`font-semibold ${selectedThread.hasLaserReply ? "text-emerald-600" : "text-rose-600"}`}>
                    {selectedThread.hasLaserReply ? "Replied" : "No Reply Received"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-semibold uppercase">Messages in Thread</span>
                  <span className="font-semibold text-foreground">{selectedThread.msgCount} messages</span>
                </div>
              </div>

              {/* Attachments Section in Modal */}
              {selectedThread.attachNames.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                    Attached Files ({selectedThread.attachNames.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedThread.attachNames.map((name, idx) => {
                      const link = selectedThread.attachLinks[name];
                      const isPdf = name.toLowerCase().endsWith(".pdf");
                      const isExcel = name.toLowerCase().endsWith(".xlsx") || name.toLowerCase().endsWith(".xls");

                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border transition-colors text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isPdf ? (
                              <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                            ) : isExcel ? (
                              <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Paperclip className="w-4 h-4 text-blue-500 shrink-0" />
                            )}
                            <span className="font-medium text-foreground truncate" title={name}>
                              {name}
                            </span>
                          </div>
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900 text-[11px] font-semibold flex items-center gap-1 shrink-0 ml-2 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              Open
                            </a>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic shrink-0 ml-2">Internal storage</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Thread Messages Conversation */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wide">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  Conversation Thread ({selectedThread.messages.length} Messages)
                </h4>

                <div className="space-y-3">
                  {selectedThread.messages.map((m, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-lg bg-card border border-border shadow-2xs space-y-2"
                    >
                      <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px]">
                            {m.num}
                          </span>
                          {m.sender}
                        </span>
                      </div>
                      <div className="text-xs text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed">
                        {m.body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-muted/40 border-t border-border flex items-center justify-end shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedThread(null)}
                className="h-8 px-4 text-xs font-medium cursor-pointer"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
