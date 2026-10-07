"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@gmd/ui/components/dialog";
import { Badge } from "@gmd/ui/components/badge";
import {
  ExternalLink,
  Paperclip,
  Mail,
  Clock,
  User,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Send,
  Building2,
  FileText,
  ArrowRight,
  MessageSquare,
  Layers,
  ChevronRight,
  Maximize2,
  X,
} from "lucide-react";

interface ThreadDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: any | null;
}

export default function ThreadDetailModal({
  isOpen,
  onClose,
  row,
}: ThreadDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"lifecycle" | "all_threads">("lifecycle");

  if (!row) return null;

  const req = row.partyRequestDetails || {};
  const quote = row.quoteDetails || {};
  const reply = row.partyReplyDetails || {};
  const allThreads = row.allThreads || [];
  const attachLinks: Record<string, string> =
    (row.attachLinks as Record<string, string>) ||
    (quote.attachLinks as Record<string, string>) ||
    {};

  const getAttachmentLink = (filename: string): string | null => {
    if (!filename) return null;
    const trimmed = filename.trim();
    if (attachLinks[trimmed]) return attachLinks[trimmed];
    if (attachLinks[filename]) return attachLinks[filename];

    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(attachLinks)) {
      if (k.trim().toLowerCase() === lower && typeof v === "string" && v) return v;
    }

    for (const [k, v] of Object.entries(attachLinks)) {
      const kLower = k.trim().toLowerCase();
      if ((lower.includes(kLower) || kLower.includes(lower)) && typeof v === "string" && v) return v;
    }
    return null;
  };

  // Documents on record for this docket. When a quotation was dispatched we
  // show its files; otherwise we show the enquiry/spec documents received, so a
  // docket with no quotation still lists the PDFs that exist for it.
  const docketFiles: string[] = (() => {
    const out: string[] = [];
    const add = (n: unknown) => {
      if (typeof n === "string" && n.trim() && !out.includes(n)) out.push(n);
    };
    if (row.quotationSent && Array.isArray(quote.attachments) && quote.attachments.length > 0) {
      quote.attachments.forEach(add);
    } else {
      (Array.isArray(row.enquiryFiles) ? row.enquiryFiles : []).forEach(add);
      (Array.isArray(row.threadFiles) ? row.threadFiles : []).forEach(add);
    }
    return out;
  })();
  const docketFilesAreQuotation =
    !!row.quotationSent && Array.isArray(quote.attachments) && quote.attachments.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="w-[96vw] max-w-[1440px] sm:max-w-[95vw] md:max-w-[94vw] lg:max-w-[1380px] xl:max-w-[1480px] max-h-[94vh] overflow-y-auto p-0 gap-0 border-border bg-card shadow-2xl">
        <DialogTitle className="sr-only">
          Docket {row.docketNumber} Communication Details
        </DialogTitle>
        <DialogDescription className="sr-only">
          3-Stage communication breakdown for docket {row.docketNumber}
        </DialogDescription>

        {/* Header Banner - Wide & Spacious */}
        <div className="p-4 sm:p-5 border-b border-border bg-muted/40 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-2xl font-black tracking-tight text-foreground font-mono">
                  {row.docketNumber}
                </span>
                {row.enquiryType && (
                  <Badge variant="outline" className="text-[11px] font-semibold uppercase bg-background px-2 py-0.5">
                    {row.enquiryType}
                  </Badge>
                )}
                {row.state && (
                  <Badge variant="secondary" className="text-[11px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 px-2 py-0.5">
                    {row.state} {row.utility ? `(${row.utility})` : ""}
                  </Badge>
                )}
                {row.actionPending ? (
                  <Badge variant="destructive" className="text-[11px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 px-2 py-0.5">
                    <AlertCircle className="w-3.5 h-3.5 mr-1" />
                    Action Pending (No Email Found)
                  </Badge>
                ) : (
                  <Badge className="text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2 py-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Email Thread Linked ({row.threadsCount})
                  </Badge>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground/90 mt-1.5 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
                <span className="font-bold text-base text-foreground">{row.partyName}</span>
              </p>
            </div>

            {/* Stepper Quick Summary Bar + Close (✕) Button */}
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-1.5 bg-background border border-border rounded-xl p-1.5 text-xs shadow-xs">
                {/* Step 1 Pill */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25">
                  <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
                  <span>1. Party Request</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />

                {/* Step 2 Pill */}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold border ${
                    row.quotationSent
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/25"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  <Send className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                  <span>2. Quote {row.quotationSent ? "Sent" : "Pending"}</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />

                {/* Step 3 Pill */}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold border ${
                    row.partyReplyStatus === "REPLY_ARRIVED"
                      ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/25"
                      : row.partyReplyStatus === "AWAITING_REPLY"
                      ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200 dark:border-amber-500/25"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />
                  <span>
                    3. {row.partyReplyStatus === "REPLY_ARRIVED" ? "Reply Arrived" : row.partyReplyStatus === "AWAITING_REPLY" ? "Awaiting Reply" : "No Quote"}
                  </span>
                </div>
              </div>

              {/* Visible, Prominent Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs hover:scale-105 active:scale-95"
                title="Close Window (Esc)"
                aria-label="Close"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 pt-2.5 border-t border-border/60">
            <button
              onClick={() => setActiveTab("lifecycle")}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === "lifecycle"
                  ? "bg-blue-600 dark:bg-blue-500/25 text-white dark:text-blue-100 shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              3-Stage Communication Pipeline (Side-by-Side View)
            </button>
            <button
              onClick={() => setActiveTab("all_threads")}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "all_threads"
                  ? "bg-blue-600 dark:bg-blue-500/25 text-white dark:text-blue-100 shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              All Messages / Thread History ({allThreads.length})
            </button>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="p-4 sm:p-6 space-y-4">
          {row.actionPending ? (
            <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-xl border border-dashed border-border">
              <AlertCircle className="w-14 h-14 text-rose-500/80" />
              <div className="max-w-md">
                <p className="font-bold text-foreground text-lg">No Communication Linked Yet</p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  This enquiry was registered in the database, but no inbound requests, outbound quotations, or replies have been identified in the email database for docket{" "}
                  <span className="font-mono font-semibold text-foreground">{row.docketNumber}</span>.
                </p>
              </div>
            </div>
          ) : activeTab === "lifecycle" ? (
            /* 3-STAGE PIPELINE: 3 COLUMNS SIDE-BY-SIDE ON DESKTOP */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              {/* ========================================================================= */}
              {/* STAGE 1: REQUEST FROM THE PARTY (Inbound Enquiry) */}
              {/* ========================================================================= */}
              <div className="rounded-xl border border-blue-200 dark:border-blue-500/20 bg-blue-50/20 dark:bg-blue-500/5 flex flex-col overflow-hidden shadow-xs">
                {/* Column Header */}
                <div className="p-3.5 bg-blue-100/70 dark:bg-blue-500/15 border-b border-blue-200 dark:border-blue-500/20 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500/25 text-white dark:text-blue-100 text-xs font-bold shrink-0">
                      1
                    </span>
                    <span className="font-bold text-xs text-blue-950 dark:text-blue-200 uppercase tracking-wide">
                      Request From Party
                    </span>
                  </div>
                  {req.initialDate && (
                    <span className="text-[11px] text-blue-900/80 dark:text-blue-300 font-mono font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(req.initialDate).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </div>

                {/* Column Body */}
                <div className="p-3.5 space-y-3 text-xs flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    {/* Subject */}
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                        Subject / Enquiry Title
                      </span>
                      <p className="text-xs font-semibold text-foreground bg-background p-2 rounded-lg border border-border/80">
                        {req.initialSubject || "(No Subject Detected)"}
                      </p>
                    </div>

                    {/* Sender & Party Email */}
                    <div className="space-y-2">
                      <div className="bg-background p-2 rounded-lg border border-border/80">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                          Inbound Sender / Originator
                        </span>
                        <p className="font-mono text-foreground text-[11px] font-medium break-all">
                          {req.initialSender || row.partyEmail || "Direct Portal / Enquiry Entry"}
                        </p>
                      </div>

                      <div className="bg-background p-2 rounded-lg border border-border/80">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                          Party Client Email
                        </span>
                        <p className="font-mono text-blue-700 dark:text-blue-300 text-[11px] font-semibold break-all">
                          {row.partyEmail || "Not identified in mail headers"}
                        </p>
                      </div>
                    </div>

                    {/* Inbound Message Snippet */}
                    {req.initialSnippet && (
                      <div>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                          Inbound Message Preview
                        </span>
                        <div className="p-2.5 bg-background rounded-lg border border-border/80 text-[11px] font-mono leading-relaxed text-foreground/90 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {req.initialSnippet}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Specifications & Tender Docs */}
                  {req.initialFiles && req.initialFiles.length > 0 && (
                    <div className="pt-2 border-t border-blue-200/60 dark:border-blue-500/20">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Inbound Specifications / Tender Docs ({req.initialFiles.length})
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {req.initialFiles.map((name: string, i: number) => {
                          const link = getAttachmentLink(name);
                          return link ? (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] rounded-md bg-background hover:bg-blue-50 dark:hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-border hover:border-blue-300 dark:hover:border-blue-500/25 transition-colors"
                            >
                              <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-300 shrink-0" />
                              <span className="truncate max-w-[170px]">{name}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                            </a>
                          ) : (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] rounded-md bg-muted text-muted-foreground border border-border"
                            >
                              <Paperclip className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[170px]">{name}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* STAGE 2: OUR LAST MAIL TO THE PARTY (Quotation Dispatched) */}
              {/* ========================================================================= */}
              <div
                className={`rounded-xl border flex flex-col overflow-hidden shadow-xs ${
                  row.quotationSent
                    ? "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-500/5"
                    : "border-amber-200 dark:border-amber-500/20 bg-amber-50/20 dark:bg-amber-500/5"
                }`}
              >
                {/* Column Header */}
                <div
                  className={`p-3.5 border-b flex items-center justify-between gap-2 ${
                    row.quotationSent
                      ? "bg-emerald-100/70 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/20"
                      : "bg-amber-100/70 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-white dark:text-foreground text-xs font-bold shrink-0 ${
                        row.quotationSent ? "bg-emerald-600 dark:bg-emerald-500/25" : "bg-amber-600 dark:bg-amber-500/25"
                      }`}
                    >
                      2
                    </span>
                    <span
                      className={`font-bold text-xs uppercase tracking-wide ${
                        row.quotationSent
                          ? "text-emerald-950 dark:text-emerald-200"
                          : "text-amber-950 dark:text-amber-200"
                      }`}
                    >
                      Our Quotation To Party
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {row.quotationSent ? (
                      <Badge className="bg-emerald-600 dark:bg-emerald-500/25 text-white dark:text-emerald-100 font-semibold text-[10px]">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Dispatched
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 dark:border-amber-500/25 dark:bg-amber-500/12 dark:text-amber-300 text-[10px] font-semibold">
                        <Clock className="w-3 h-3 mr-1" />
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Column Body */}
                <div className="p-3.5 space-y-3 text-xs flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    {row.quotationSent ? (
                      <>
                        {/* Sent Date & Sender */}
                        <div className="space-y-2">
                          <div className="bg-background p-2 rounded-lg border border-border/80">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                              Dispatched Timestamp
                            </span>
                            <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                              {row.quotationSentDate
                                ? new Date(row.quotationSentDate).toLocaleDateString("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Recorded in thread"}
                            </p>
                          </div>

                          <div className="bg-background p-2 rounded-lg border border-border/80">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                              Our Sender
                            </span>
                            <p className="font-mono text-foreground text-[11px] font-medium break-all">
                              {quote.sender || "G.M. Dalui & Sons Representative"}
                            </p>
                          </div>
                        </div>

                        {/* Method & Verification */}
                        {row.quotationMethod && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-[11px]">
                            <span className="text-emerald-800 dark:text-emerald-300 font-medium">Detection Method:</span>
                            <span className="font-mono font-bold text-emerald-900 dark:text-emerald-200 px-1.5 py-0.5 rounded bg-card dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30">
                              via {row.quotationMethod}
                            </span>
                          </div>
                        )}

                        {/* Recipient Details */}
                        <div className="bg-background p-2 rounded-lg border border-border/80 space-y-1">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                            Recipients
                          </span>
                          <div className="text-[10.5px] font-mono space-y-0.5 max-h-24 overflow-y-auto">
                            {quote.to && quote.to.length > 0 && (
                              <div>
                                <span className="font-bold text-foreground/70 mr-1">To:</span>
                                <span className="text-foreground break-all">{quote.to.join(", ")}</span>
                              </div>
                            )}
                            {quote.cc && quote.cc.length > 0 && (
                              <div>
                                <span className="font-bold text-foreground/70 mr-1">Cc:</span>
                                <span className="text-muted-foreground break-all">{quote.cc.join(", ")}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-3 bg-amber-500/10 border border-amber-300/60 dark:border-amber-500/25 rounded-lg text-amber-900 dark:text-amber-300 space-y-1">
                        <p className="font-bold text-xs flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
                          Quotation Document Pending
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          No quotation PDF or pricing proposal matching docket{" "}
                          <span className="font-mono font-semibold text-foreground">{row.docketNumber}</span> has been dispatched to the party yet.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Documents on record: dispatched quotation, or enquiry/spec files */}
                  {docketFiles.length > 0 && (
                    <div
                      className={`pt-2 border-t ${
                        docketFilesAreQuotation
                          ? "border-emerald-200/60 dark:border-emerald-500/20"
                          : "border-border"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider block mb-1.5 ${
                          docketFilesAreQuotation
                            ? "text-emerald-800 dark:text-emerald-300"
                            : "text-muted-foreground"
                        }`}
                      >
                        {docketFilesAreQuotation
                          ? `Dispatched Quotation Files (${docketFiles.length})`
                          : `Enquiry / Specification Files (${docketFiles.length})`}
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {docketFiles.map((name: string, i: number) => {
                          const link = getAttachmentLink(name);
                          const isDocketMatch =
                            name.toLowerCase().includes("gmd") ||
                            name.toLowerCase().includes("quote") ||
                            name.toLowerCase().includes(row.docketNumber.replace(/[^a-zA-Z0-9]/g, "").toLowerCase());

                          return link ? (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] rounded-md font-semibold border transition-colors ${
                                isDocketMatch
                                  ? "bg-emerald-100 hover:bg-emerald-200 dark:hover:bg-emerald-500/20 text-emerald-950 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30"
                                  : "bg-background hover:bg-muted text-foreground border-border"
                              }`}
                            >
                              <Paperclip className={`w-3 h-3 shrink-0 ${isDocketMatch ? "text-emerald-700 dark:text-emerald-300" : ""}`} />
                              <span className="truncate max-w-[170px]">{name}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                            </a>
                          ) : (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] rounded-md border ${
                                isDocketMatch
                                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/25"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              <Paperclip className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[170px]">{name}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* STAGE 3: PARTY'S LAST REPLY TO US (Feedback & Decision) */}
              {/* ========================================================================= */}
              <div
                className={`rounded-xl border flex flex-col overflow-hidden shadow-xs ${
                  row.partyReplyStatus === "REPLY_ARRIVED"
                    ? "border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/20 dark:bg-indigo-500/5"
                    : row.partyReplyStatus === "AWAITING_REPLY"
                    ? "border-amber-200 dark:border-amber-500/20 bg-amber-50/20 dark:bg-amber-500/5"
                    : "border-border bg-muted/20"
                }`}
              >
                {/* Column Header */}
                <div
                  className={`p-3.5 border-b flex items-center justify-between gap-2 ${
                    row.partyReplyStatus === "REPLY_ARRIVED"
                      ? "bg-indigo-100/70 dark:bg-indigo-500/15 border-indigo-200 dark:border-indigo-500/20"
                      : row.partyReplyStatus === "AWAITING_REPLY"
                      ? "bg-amber-100/70 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/20"
                      : "bg-muted/50 border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-white dark:text-foreground text-xs font-bold shrink-0 ${
                        row.partyReplyStatus === "REPLY_ARRIVED"
                          ? "bg-indigo-600 dark:bg-indigo-500/25"
                          : row.partyReplyStatus === "AWAITING_REPLY"
                          ? "bg-amber-600 dark:bg-amber-500/25"
                          : "bg-muted-foreground dark:bg-accent"
                      }`}
                    >
                      3
                    </span>
                    <span
                      className={`font-bold text-xs uppercase tracking-wide ${
                        row.partyReplyStatus === "REPLY_ARRIVED"
                          ? "text-indigo-950 dark:text-indigo-200"
                          : row.partyReplyStatus === "AWAITING_REPLY"
                          ? "text-amber-950 dark:text-amber-200"
                          : "text-muted-foreground"
                      }`}
                    >
                      Party's Last Reply
                    </span>
                  </div>

                  <div>
                    {row.partyReplyStatus === "REPLY_ARRIVED" ? (
                      <Badge className="bg-indigo-600 dark:bg-indigo-500/25 text-white dark:text-indigo-100 font-semibold text-[10px]">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Reply Arrived
                      </Badge>
                    ) : row.partyReplyStatus === "AWAITING_REPLY" ? (
                      <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/25 font-semibold text-[10px]">
                        <Clock className="w-3 h-3 mr-1" />
                        Awaiting Reply
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        No Quote Sent
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Column Body */}
                <div className="p-3.5 space-y-3 text-xs flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    {row.partyReplyStatus === "REPLY_ARRIVED" ? (
                      <>
                        <div className="space-y-2">
                          <div className="bg-background p-2 rounded-lg border border-border/80">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                              Party Response Timestamp
                            </span>
                            <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />
                              {row.partyReplyDate
                                ? new Date(row.partyReplyDate).toLocaleDateString("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Recorded in thread"}
                            </p>
                          </div>

                          <div className="bg-background p-2 rounded-lg border border-border/80">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                              Party Sender Address
                            </span>
                            <p className="font-mono text-indigo-700 dark:text-indigo-300 text-[11px] font-bold break-all">
                              {row.partyReplyEmail || "External Client Address"}
                            </p>
                          </div>
                        </div>

                        {/* Reply Snippet */}
                        {reply.snippet && (
                          <div>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                              Client Reply Preview
                            </span>
                            <div className="p-2.5 bg-background rounded-lg border border-border/80 text-[11px] font-mono leading-relaxed text-foreground/90 max-h-48 overflow-y-auto whitespace-pre-wrap">
                              {reply.snippet}
                            </div>
                          </div>
                        )}
                      </>
                    ) : row.partyReplyStatus === "AWAITING_REPLY" ? (
                      <div className="p-3.5 bg-amber-500/10 border border-amber-300/60 dark:border-amber-500/25 rounded-lg space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-300" />
                            Turnaround Status
                          </span>
                          {row.daysWithoutReply != null && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                              {row.daysWithoutReply === 0 ? "Sent today" : `${row.daysWithoutReply}d without reply`}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Quotation was dispatched to the client. Awaiting formal techno-commercial feedback or purchase order confirmation.
                        </p>
                        {row.daysWithoutReply != null && row.daysWithoutReply > 7 && (
                          <div className="p-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/25 rounded text-rose-800 dark:text-rose-300 text-[10.5px] font-semibold">
                            ⚠️ Overdue (&gt; 7 Days): Client has not responded for {row.daysWithoutReply} days. Follow-up reminder recommended.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-muted-foreground bg-muted/40 rounded-lg border border-border/60">
                        <p className="text-xs italic">
                          Quotation is pending dispatch. Client turnaround tracking will activate automatically once the quotation is sent.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ALL THREADS TAB */
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground mb-1">
                Showing all communication threads associated with docket <span className="font-mono font-semibold text-foreground">{row.docketNumber}</span>:
              </div>

              {allThreads.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg">
                  No individual messages available.
                </div>
              ) : (
                allThreads.map((t: any, idx: number) => (
                  <div key={idx} className="p-4 rounded-xl border border-border bg-card space-y-2 text-xs shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-muted text-muted-foreground font-mono">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-sm text-foreground">{t.subject || "(No Subject)"}</span>
                      </div>
                      {t.date && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(t.date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-semibold text-foreground/80">From:</span>{" "}
                        <span className="font-mono">{t.sender || "N/A"}</span>
                      </div>
                      {t.actionTag && (
                        <Badge variant="outline" className="text-[10px]">
                          {t.actionTag}
                        </Badge>
                      )}
                    </div>

                    {t.bodyPreview && (
                      <div className="p-3 bg-muted/40 rounded-lg border border-border/60 font-mono text-[11.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {t.bodyPreview}
                      </div>
                    )}

                    {t.attachNames && t.attachNames.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {t.attachNames.map((att: string, aIdx: number) => {
                          const link = getAttachmentLink(att);
                          return link ? (
                            <a
                              key={aIdx}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-blue-50 hover:bg-blue-100 dark:hover:bg-blue-500/20 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20 transition-colors"
                            >
                              <Paperclip className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[200px]">{att}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                            </a>
                          ) : (
                            <span
                              key={aIdx}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-muted text-muted-foreground border border-border"
                            >
                              <Paperclip className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[200px]">{att}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
