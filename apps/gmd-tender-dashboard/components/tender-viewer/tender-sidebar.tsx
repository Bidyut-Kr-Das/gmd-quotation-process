"use client";

import { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, FileText, Upload } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import FileUpload from "@/components/upload/file-upload";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { clearFiles, clearResults } from "@/lib/slices/uploadSlice";
import { setSelectedDateRange, resetSelectedDateRange } from "@/lib/slices/filesSlice";
import { importEpcGoTenders } from "@/lib/slices/tendersSlice";
import { setAnalyticsFilter } from "@/lib/slices/filtersSlice";

export interface TenderSidebarAnalytics {
  aiYes: number;
  aiYesUnallocated: number;
  apmYesAllocated: number;
  apmYesUnallocated: number;
  personCounts: { id: number; name: string; email: string; count: number }[];
}

interface TenderSidebarProps {
  rows?: Record<string, unknown>[];
  /**
   * Precomputed counts over the whole filtered set. Supplied by /tenders,
   * where only one page of rows is in memory; without it the counts are
   * derived from `rows` as before.
   */
  analytics?: TenderSidebarAnalytics | null;
  associations?: { id: number; name: string; email: string }[];
  associationFilter?: string | null;
  onAssociationFilterChange?: (val: string | null) => void;
  /** When false, upload/import actions stay visible but block with a toast. */
  isLoggedIn?: boolean;
}

export default function TenderSidebar({
  rows = [],
  analytics: analyticsProp,
  associations = [],
  associationFilter = null,
  onAssociationFilterChange,
  isLoggedIn = true,
}: TenderSidebarProps) {
  const dispatch = useAppDispatch();
  const selectedDateFrom = useAppSelector((s) => s.files.selectedDateFrom);
  const selectedDateTo = useAppSelector((s) => s.files.selectedDateTo);
  const analyticsFilter = useAppSelector((s) => s.filters.analyticsFilter);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadDialogMode, setUploadDialogMode] = useState<"parse" | "result">("parse");

  const requireLogin = useCallback(() => {
    if (isLoggedIn) return true;
    toast.error("Unauthorized! Login to continue.");
    return false;
  }, [isLoggedIn]);

  // Single pass. This previously ran four full .filter() scans plus one more
  // scan per association — O(associations x rows) with a split/filter chain
  // allocated per row per association.
  const analytics = useMemo(() => {
    if (analyticsProp !== undefined) return analyticsProp;
    if (rows.length === 0) return null;

    let aiYes = 0;
    let aiYesUnallocated = 0;
    let apmYesAllocated = 0;
    let apmYesUnallocated = 0;
    const countsById = new Map<string, number>();
    const seenIds = new Set<string>();

    for (const r of rows) {
      const assigned = String(r.assignedTo ?? "");
      const hasAssignee = !!r.assignedTo;

      if (r.aiRelevanceValid === "true") {
        aiYes++;
        if (!hasAssignee) aiYesUnallocated++;
      }
      if (r.apm === "YES") {
        if (hasAssignee) apmYesAllocated++;
        else apmYesUnallocated++;
      }
      if (assigned) {
        seenIds.clear();
        for (const id of assigned.split(",")) {
          // Dedupe within the row — the old includes() check counted a row once
          // even if it listed the same association twice. Note: no trim(), to
          // match the previous split(",").filter(Boolean) behaviour exactly.
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          countsById.set(id, (countsById.get(id) ?? 0) + 1);
        }
      }
    }

    return {
      aiYes,
      aiYesUnallocated,
      apmYesAllocated,
      apmYesUnallocated,
      personCounts: associations
        .map((a) => ({ ...a, count: countsById.get(String(a.id)) ?? 0 }))
        .filter((p) => p.count > 0),
    };
  }, [analyticsProp, rows, associations]);

  const selectedRange: DateRange | undefined =
    selectedDateFrom && selectedDateTo
      ? { from: new Date(selectedDateFrom), to: new Date(selectedDateTo) }
      : undefined;

  const handleImportEpc = useCallback(async () => {
    if (!requireLogin()) return;
    const toastId = toast.loading(
      "Syncing tenders from executive dashboard...",
    );
    try {
      const result = await dispatch(importEpcGoTenders()).unwrap();
      toast.dismiss(toastId);
      if (result.inserted === 0) {
        toast.info("No GO tenders to import");
      } else {
        toast.success(
          `Imported ${result.inserted} tender(s)`,
          {
            description: `${result.merged} merged (existing)${result.errors.length ? ` · ${result.errors.length} error(s)` : ""}`,
          },
        );
      }
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          toast.error(`${e.referenceNo}: ${e.error}`);
        }
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error("Import failed", {
        description: err.message ?? "Unknown error",
      });
    }
  }, [dispatch, requireLogin]);

  const closeDialog = useCallback(() => {
    dispatch(clearFiles());
    dispatch(clearResults());
    setShowUploadDialog(false);
  }, [dispatch]);

  const handleAnalyticsCardClick = useCallback(
    (value: "aiYes" | "aiYesUnallocated" | "apmYesAllocated" | "apmYesUnallocated") => {
      dispatch(setAnalyticsFilter(analyticsFilter === value ? null : value));
      dispatch(resetSelectedDateRange());
      onAssociationFilterChange?.(null);
    },
    [dispatch, analyticsFilter, onAssociationFilterChange],
  );

  return (
    <>
      <aside className="w-65 min-w-65 bg-linear-to-b from-brand to-brand flex flex-col overflow-y-auto shrink-0">
        <div className="px-5 py-4.5 pb-3.5 flex items-center gap-2 border-b border-white/10">
          <div className="flex items-center justify-center w-6 h-6 rounded-sm bg-white/10">
            <FileText size={14} className="text-white/80" />
          </div>
          <span className="text-xs font-bold text-white tracking-wider uppercase">
            Tender Dashboard
          </span>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-2.5">
              Upload Tenders
            </div>
            <button
              onClick={() => {
                if (!requireLogin()) return;
                setUploadDialogMode("parse");
                setShowUploadDialog(true);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-md bg-white/10 text-white/80 text-xs font-medium hover:bg-white/20 transition-colors border border-dashed border-white/20 cursor-pointer"
            >
              <Upload size={14} />
              Upload Files
            </button>
            <button
              onClick={() => {
                if (!requireLogin()) return;
                setUploadDialogMode("result");
                setShowUploadDialog(true);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-md bg-emerald-600/20 text-emerald-300 text-xs font-medium hover:bg-emerald-600/30 transition-colors border border-dashed border-emerald-400/30 cursor-pointer mt-2"
            >
              <Upload size={14} />
              Upload Result
            </button>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-2.5">
              Uploaded At
            </div>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 px-3 py-2 h-auto text-xs font-normal rounded-md bg-white/10 text-white/80 border-white/20 hover:bg-white/20 hover:text-white"
                  >
                    <CalendarIcon size={14} />
                    {selectedRange?.from ? (
                      selectedRange.to ? (
                        <>
                          {format(selectedRange.from, "LLL dd, y")}
                          {" - "}
                          {format(selectedRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(selectedRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>All Files</span>
                    )}
                  </Button>
                }
              />
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  defaultMonth={selectedRange?.from ?? undefined}
                  selected={selectedRange}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      const from = new Date(range.from);
                      const to = new Date(range.to);
                      from.setHours(0, 0, 0, 0);
                      to.setHours(0, 0, 0, 0);
                      dispatch(
                        setSelectedDateRange({
                          from: from.toISOString(),
                          to: to.toISOString(),
                        }),
                      );
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-2.5">
              Assigned To
            </div>
            <Select
              value={associationFilter ?? ""}
              onValueChange={(v) => onAssociationFilterChange?.(v ? v : null)}
            >
              <SelectTrigger
                size="sm"
                className="w-full justify-start gap-2 px-3 py-2 h-auto text-xs font-normal rounded-md bg-white/10 text-white/80 border-white/20 hover:bg-white/20 hover:text-white [&_svg]:text-white/70"
              >
                <SelectValue placeholder="All People" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All People</SelectItem>
                {associations.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {analytics && (
            <>
              <button
                type="button"
                onClick={() => handleAnalyticsCardClick("aiYes")}
                className={`w-full rounded-lg p-3 text-left transition-colors cursor-pointer ${
                  analyticsFilter === "aiYes"
                    ? "bg-brand/20 border border-brand-accent/50"
                    : "bg-white/10 border border-transparent hover:bg-white/20"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  AI Relevance Yes
                </div>
                <div className="text-xl font-bold text-lime-500 leading-tight">
                  {analytics.aiYes}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleAnalyticsCardClick("aiYesUnallocated")}
                className={`w-full rounded-lg p-3 text-left transition-colors cursor-pointer ${
                  analyticsFilter === "aiYesUnallocated"
                    ? "bg-brand/20 border border-brand-accent/50"
                    : "bg-white/10 border border-transparent hover:bg-white/20"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  AI Relevance Yes (Unallocated)
                </div>
                <div className="text-xl font-bold text-rose-500 leading-tight">
                  {analytics.aiYesUnallocated}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleAnalyticsCardClick("apmYesAllocated")}
                className={`w-full rounded-lg p-3 text-left transition-colors cursor-pointer ${
                  analyticsFilter === "apmYesAllocated"
                    ? "bg-brand/20 border border-brand-accent/50"
                    : "bg-white/10 border border-transparent hover:bg-white/20"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  APM Yes (Allocated)
                </div>
                <div className="text-xl font-bold text-yellow-500 leading-tight">
                  {analytics.apmYesAllocated}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleAnalyticsCardClick("apmYesUnallocated")}
                className={`w-full rounded-lg p-3 text-left transition-colors cursor-pointer ${
                  analyticsFilter === "apmYesUnallocated"
                    ? "bg-brand/20 border border-brand-accent/50"
                    : "bg-white/10 border border-transparent hover:bg-white/20"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  APM Yes (Unallocated)
                </div>
                <div className="text-xl font-bold text-brand-light leading-tight">
                  {analytics.apmYesUnallocated}
                </div>
              </button>
              {analytics.personCounts.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-2.5">
                    Assigned Tenders by Person
                  </div>
                  <div className="space-y-1.5">
                    {analytics.personCounts.map((p) => {
                      const isActive = associationFilter === String(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            onAssociationFilterChange?.(
                              isActive ? null : String(p.id),
                            )
                          }
                          className={`w-full flex items-center justify-between py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer ${
                            isActive
                              ? "bg-brand/20 border border-brand-accent/50"
                              : "bg-white/10 border border-transparent hover:bg-white/20"
                          }`}
                        >
                          <span className="text-xs text-white/70">{p.name}</span>
                          <span className="text-xs font-semibold text-white">
                            {p.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {showUploadDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={closeDialog}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">
                {uploadDialogMode === "parse" ? "Upload Tenders" : "Upload Result"}
              </h3>
              <button
                onClick={closeDialog}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                ×
              </button>
            </div>
            <FileUpload mode={uploadDialogMode} />
          </div>
        </div>
      )}
    </>
  );
}
