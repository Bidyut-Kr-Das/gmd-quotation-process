"use client";

import { DataEmptyState } from "@/components/ui/data-state";
import { Button } from "@/components/ui/button";
import React, {
  useEffect,
  useCallback,
  useMemo,
  useState,
  useRef,
  memo,
} from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  updateTenderCell,
  updateTenderMergedField,
  updateTenderAssignments,
  updateWebsiteMapping,
  bulkAssignUtilityMapping,
  saveFeedbackAndReanalyze,
  uploadTenderDocument,
  updateTenderRemarks,
  updateTenderReasonForNotAPM,
} from "@/lib/slices/tendersSlice";
import { REASON_FOR_NOT_APM_OPTIONS } from "@/lib/reason-for-not-apm";
import { signIn, useSession } from "next-auth/react";
import { setExclusionFilter } from "@/lib/slices/filtersSlice";
import {
  OptimizedTenderTable,
  ColumnDef,
} from "@/components/tender-viewer/optimized-tender-table/OptimizedTenderTable";
import {
  clearStale,
  setMergedGroups,
  loadTenderFacet,
  loadTenderPage,
  loadTenderSummary,
  selectTenderQuery,
  setAssociationFilter as setAssociationFilterAction,
  setPage,
  setPageSize,
  setSort,
  tenderQueryKey,
} from "@/lib/slices/tenderPageSlice";
import type { FilterOption } from "@/lib/types";
import type { TenderQuery } from "@/lib/tender-query";
import { needsFacetQuery } from "@/lib/tender-filter-meta";
import { fetchAllFilteredTenderRows } from "@/actions/tender-query";
import { loadColumnConfig } from "@/lib/columnConfig";
import { toast } from "sonner";
import TenderSidebar from "@/components/tender-viewer/tender-sidebar";
import ConfirmAnalysisDialog from "@/components/tender-viewer/confirm-analysis-dialog";
import AiFeedbackDialog from "@/components/tender-viewer/ai-feedback-dialog";
import DashboardSkeleton from "@/components/tender-viewer/dashboard-skeleton";
import WebsiteEditDialog from "@/components/tender-viewer/website-edit-dialog";
import TenderDocumentUploadDialog from "@/components/tender-viewer/tender-document-upload-dialog";
import { AttachmentModal } from "@/components/AttachmentModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  LogIn,
  MessageSquare,
  Pencil,
  Check,
  FileText,
  Lock,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getDisplayNameMap } from "@/lib/tender-columns";
import { getProvenance, getProvenanceForFields } from "@/lib/columnProvenance";

const normalizeKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

function RemarksCell({
  value,
  row,
  isSaving,
  canEdit,
  dispatch,
}: {
  value: unknown;
  row: Record<string, unknown>;
  isSaving: boolean;
  canEdit: boolean;
  dispatch: ReturnType<typeof useAppDispatch>;
}) {
  const val = String(value ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(val);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rowKey = `${row.id}-${row.type}`;

  useEffect(() => {
    setDraft(val);
    setEditing(false);
  }, [rowKey]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [editing]);

  const save = () => {
    if (draft !== val) {
      dispatch(
        updateTenderRemarks({
          tenderMergedId: Number(row.id),
          remarks: draft,
          oldRemarks: val,
        }),
      )
        .unwrap()
        .then(() => toast.success("Remarks updated"))
        .catch((err: Error) =>
          toast.error(err.message || "Failed to update remarks"),
        );
    }
    setEditing(false);
  };

  if (!canEdit) {
    return (
      <div style={{ height: "100%", minHeight: 160, whiteSpace: "normal" }}>
        {val || <span className="text-muted-foreground/60">-</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{ display: "inline-flex", gap: 4, alignItems: "flex-start" }}>
        <textarea
          ref={textareaRef}
          value={draft}
          rows={3}
          disabled={isSaving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) return;
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              setDraft(val);
              setEditing(false);
            }
          }}
          style={{
            width: "100%",
            minWidth: 180,
            fontSize: 11,
            padding: "4px 6px",
            resize: "vertical",
            border: "1px solid #dadce0",
            borderRadius: 4,
          }}
        />
        <button
          onClick={save}
          disabled={isSaving}
          className="flex-shrink-0 mt-0.5 w-6 h-6 rounded flex items-center justify-center bg-brand hover:bg-brand-accent text-white cursor-pointer"
          title="Save"
        >
          {isSaving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Check className="w-3 h-3" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative group/cell h-full">
      <div style={{ height: "100%", minHeight: 160, whiteSpace: "normal" }}>
        {val || <span className="text-muted-foreground/60">-</span>}
      </div>
      <button
        className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
        title="Edit Remarks"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(val);
          setEditing(true);
        }}
      >
        {isSaving ? (
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        ) : (
          <Pencil className="w-4 h-4 text-white" />
        )}
      </button>
    </div>
  );
}

function DivisionOrDepartmentCell({ value }: { value: unknown }) {
  const raw = String(value ?? "").trim();
  if (!raw) return <span className="text-muted-foreground/60">-</span>;
  const key = raw.toUpperCase();
  const map: Record<string, string> = {
    "LASER PROJECTS": "bg-brand-light text-signal border-signal/40",
    "LASER MANUFACTURING": "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  const cls = map[key] ?? "bg-muted text-muted-foreground border-border";
  return (
    <Badge className={`text-[10px] font-medium border ${cls}`}>{raw}</Badge>
  );
}

const AgentReportCell = memo(function AgentReportCell({
  value,
  onOpen,
}: {
  value: unknown;
  onOpen: (report: string) => void;
}) {
  const raw = String(value ?? "").trim();
  if (!raw) return <span className="text-muted-foreground/60">-</span>;
  return (
    <button
      type="button"
      title="Show Agent Report"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(raw);
      }}
      className="rounded-md bg-brand-light border-2 border-brand text-brand px-3 py-1.5 text-xs font-medium hover:bg-brand-accent hover:text-white transition-colors cursor-pointer"
    >
      Show Agent Report
    </button>
  );
});

function formatColumnName(name: string): string {
  if (name === "t247Id") return "Portal ID";
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

const EMPTY_FILTER_OPTIONS: Record<string, FilterOption[]> = {};

export default function Dashboard() {
  const dispatch = useAppDispatch();
  const selectedDateFrom = useAppSelector((s) => s.files.selectedDateFrom);
  const selectedDateTo = useAppSelector((s) => s.files.selectedDateTo);
  const files = useAppSelector((s) => s.files.items);
  const loadingFiles = useAppSelector((s) => s.files.loading);
  const pageRows = useAppSelector((s) => s.tenderPage.rows);
  const pageColumns = useAppSelector((s) => s.tenderPage.columns);
  const pageAssociations = useAppSelector((s) => s.tenderPage.associations);
  const pageStatus = useAppSelector((s) => s.tenderPage.status);
  const pageTotal = useAppSelector((s) => s.tenderPage.total);
  const pageNumber = useAppSelector((s) => s.tenderPage.page);
  const pageSize = useAppSelector((s) => s.tenderPage.pageSize);
  const pageSort = useAppSelector((s) => s.tenderPage.sort);
  const pageFacets = useAppSelector((s) => s.tenderPage.facets);
  const pageSummary = useAppSelector((s) => s.tenderPage.summary);
  const pageStale = useAppSelector((s) => s.tenderPage.stale);
  const associationFilter = useAppSelector((s) => s.tenderPage.associationFilter);

  // The table still consumes the same {columns, rows, associations} shape the
  // streamed dataset had - it is just one page wide now.
  const tenderData = useMemo(
    () =>
      pageColumns.length > 0
        ? {
            columns: pageColumns,
            rows: pageRows as Record<string, string | undefined>[],
            associations: pageAssociations,
          }
        : null,
    [pageColumns, pageRows, pageAssociations],
  );
  const loadingTenders = pageStatus === "loading" && pageColumns.length === 0;
  const totalFiles = useAppSelector((s) => s.tenders.totalFiles);
  const completedFiles = useAppSelector((s) => s.tenders.completedFiles);
  const updatingCells = useAppSelector((s) => s.tenders.updatingCells);
  const uploadResults = useAppSelector((s) => s.upload.results);
  const resultUploadVersion = useAppSelector(
    (s) => s.upload.resultUploadVersion,
  );

  const [displayNameMap, setDisplayNameMap] = useState<Record<string, string>>(
    {},
  );
  // const [mergedGroups, setMergedGroups] = useState<{
  //   label: string;
  //   separator: string;
  //   fields: string[];
  // }[]>([]);
  const [columnIndices, setColumnIndices] = useState<
    {
      columnName: string;
      displayOrder: number;
      visible: boolean;
      width: number | null;
      frozen: boolean;
      createdAt: string;
    }[]
  >([]);
  // Merged column definitions live in the store so selectTenderQuery can send
  // them to the server, which needs them to filter and sort those columns.
  const mergedGroups = useAppSelector((s) => s.tenderPage.mergedGroups);
  const [feedbackRow, setFeedbackRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [websiteEditRow, setWebsiteEditRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [documentUploadRow, setDocumentUploadRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [agentReportContent, setAgentReportContent] = useState<string | null>(
    null,
  );
  const handleOpenAgentReport = useCallback(
    (report: string) => setAgentReportContent(report),
    [],
  );
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>[]>(
    [],
  );
  const [syncingDockets, setSyncingDockets] = useState(false);

  const handleOpenAttachmentModal = useCallback(
    (files: Record<string, string>[]) => {
      setSelectedFiles(files);
      setIsAttachmentModalOpen(true);
    },
    [],
  );
  const feedbackSaving = useAppSelector((s) => s.tenders.feedbackSaving);
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";
  const canEditRemarks = isLoggedIn;

  // Single gate for every mutating interaction. Returns false and toasts when
  // the visitor is not authenticated.
  const canMutate = useCallback(() => {
    if (isLoggedIn) return true;
    toast.error("Unauthorized! Login to continue.");
    return false;
  }, [isLoggedIn]);

  const tenderDataRef = useRef(tenderData);
  tenderDataRef.current = tenderData;
  const updatingCellsRef = useRef(updatingCells);
  updatingCellsRef.current = updatingCells;
  const feedbackSavingRef = useRef(feedbackSaving);
  feedbackSavingRef.current = feedbackSaving;

  const prevTenderDataRef = useRef(tenderData);
  const prevOrderedColsRef = useRef<string[]>([]);
  useEffect(() => {
    if (prevTenderDataRef.current !== tenderData) {
      const added = tenderData?.columns.filter(
        (c) => !prevTenderDataRef.current?.columns.includes(c),
      );
      // console.log(
      //   `[tenderData changed] identity=${Object.is(prevTenderDataRef.current, tenderData)}`,
      //   `prevCols=${prevTenderDataRef.current?.columns.length ?? 0}`,
      //   `newCols=${tenderData?.columns.length ?? 0}`,
      //   `added=${added?.length ? JSON.stringify(added) : "none"}`,
      // );
      prevTenderDataRef.current = tenderData;
    }
  });

  // Kept so callers (parse completion, uploads) can force a reload; it now
  // refetches the current page instead of the whole table.
  const refreshTenders = useCallback(() => {
    dispatch(clearStale());
    reloadRef.current?.();
  }, [dispatch]);

  const handleSyncDockets = useCallback(async () => {
    setSyncingDockets(true);
    try {
      const res = await fetch("/api/sync-dockets", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(`Docket sync failed: ${data.error}`);
      } else {
        const s = data.stats;
        toast.success(
          `Dockets synced: ${s.foundInEmailSubject + s.foundInEnquiryTender} filled, ` +
            `${s.notFound} not found, ${s.errors} errors`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Docket sync failed");
    } finally {
      setSyncingDockets(false);
    }
  }, []);

  useEffect(() => {
    if (uploadResults && uploadResults.length > 0) {
      refreshTenders();
    }
  }, [uploadResults, refreshTenders]);

  useEffect(() => {
    if (resultUploadVersion > 0) {
      refreshTenders();
    }
  }, [resultUploadVersion, refreshTenders]);

  useEffect(() => {
    loadColumnConfig()
      .then(({ mappings, groups, indices }) => {
        if (mappings) {
          setDisplayNameMap(getDisplayNameMap(mappings));
        }
        if (groups) {
          dispatch(
            setMergedGroups(
              groups.map((g) => ({
                label: g.label,
                separator: g.separator,
                fields: JSON.parse(g.fields) as string[],
              })),
            ),
          );
        }
        if (indices) {
          setColumnIndices(indices);
        }
      })
      .catch(() => {});
  }, []);

  const handleAssignmentChange = useCallback(
    (rowIndex: number, type: string, id: string, associationIds: string[]) => {
      if (!canMutate()) return;
      if (!tenderDataRef.current) return;
      const oldValue = tenderDataRef.current.rows[rowIndex]?.assignedTo ?? "";
      dispatch(
        updateTenderAssignments({
          rowIndex,
          tenderMergedId: parseInt(id, 10),
          associationIds: associationIds.map(Number),
          oldValue,
        }),
      );
    },
    [dispatch, canMutate],
  );

  const handleDecisionClick = useCallback(
    (
      col: string,
      rowIndex: number,
      type: string,
      id: string,
      value: string,
    ) => {
      if (!canMutate()) return;
      if (!tenderDataRef.current) return;
      const oldValue = tenderDataRef.current.rows[rowIndex]?.[col] ?? "";
      const newValue = oldValue === value ? "NOT_DECIDED" : value;
      const toastId = toast.loading(`Updating ${col.toUpperCase()}...`);
      dispatch(
        updateTenderCell({
          rowIndex,
          field: col,
          value: newValue,
          tenderMergedId: parseInt(id, 10),
          oldValue,
        }),
      )
        .unwrap()
        .then((result) => {
          toast.success(`${col.toUpperCase()} set to ${newValue}`, {
            id: toastId,
          });
          if (result?.webhookTriggered) {
            const ref = result.referenceNo ?? "";
            if (result.webhookResponse?.message) {
              const toastFn = result.webhookResponse.success
                ? toast.success
                : toast.error;
              toastFn(`${ref}: ${result.webhookResponse.message}`);
            }
          }
        })
        .catch((err: Error) => {
          toast.error(`Failed to update: ${err.message}`, { id: toastId });
        });
    },
    [dispatch, canMutate],
  );

  const handleSaveFeedback = useCallback(
    (params: {
      tenderMergedId: number;
      tenderType: string;
      briefText: string;
      originalAi: string;
      correctedAi: string;
      feedbackReason: string;
    }) => {
      if (!canMutate()) return;
      const toastId = toast.loading("Saving feedback and re-analyzing...");
      dispatch(saveFeedbackAndReanalyze(params))
        .unwrap()
        .then(() => {
          toast.success("Feedback saved, tender re-analyzed", { id: toastId });
        })
        .catch((err: Error) => {
          const msg =
            err.message === "rate_limit"
              ? "Re-analysis rate limited, try again later"
              : `Failed: ${err.message}`;
          toast.error(msg, { id: toastId });
        })
        .finally(() => {
          setFeedbackRow(null);
        });
    },
    [dispatch, canMutate],
  );

  const handleWebsiteSave = useCallback(
    (params: { tenderMergedId: number; website: string; oldValue: string }) => {
      if (!canMutate()) return;
      const toastId = toast.loading("Saving website...");
      dispatch(
        updateWebsiteMapping({
          tenderMergedId: params.tenderMergedId,
          website: params.website,
          oldValue: params.oldValue,
        }),
      )
        .unwrap()
        .then((result) => {
          toast.success("Website saved", { id: toastId });
          setWebsiteEditRow(null);
          dispatch(
            bulkAssignUtilityMapping({
              organization: result.organization,
              website: params.website,
              utilityMappingId: result.utilityMappingId,
              excludeTenderMergedId: params.tenderMergedId,
            }),
          )
            .unwrap()
            .then((bulkResult) => {
              const total = bulkResult.updatedIds.length;
              if (total > 0) {
                toast.success(
                  `Updated ${total} tender${total > 1 ? "s" : ""} with same organization`,
                );
              }
            })
            .catch((err: Error) => {
              toast.error(`Bulk update failed: ${err.message}`);
            });
        })
        .catch((err: Error) => {
          toast.error(`Failed: ${err.message}`, { id: toastId });
          setWebsiteEditRow(null);
        });
    },
    [dispatch, canMutate],
  );

  const handleDocumentUpload = useCallback(
    (params: { tenderMergedId: number; file: File; fileType: string }) => {
      if (!canMutate()) return;
      const toastId = toast.loading("Uploading tender file...");
      dispatch(
        uploadTenderDocument({
          tenderMergedId: params.tenderMergedId,
          file: params.file,
          fileType: params.fileType,
        }),
      )
        .unwrap()
        .then(() => {
          toast.success("Tender file uploaded", { id: toastId });
          setDocumentUploadRow(null);
          refreshTenders();
        })
        .catch((err: Error) => {
          toast.error(`Failed: ${err.message}`, { id: toastId });
          setDocumentUploadRow(null);
        });
    },
    [dispatch, refreshTenders, canMutate],
  );

  // Filter dropdown values come from the database now, one column at a time,
  // so the column definitions only carry their static options.
  const selectFilterOptions: Record<string, FilterOption[]> = EMPTY_FILTER_OPTIONS;

  const orderedColumns = useMemo(() => {
    if (!tenderData) return [];
    const skipCols = new Set([
      "sr. no.",
      "sr no",
      "s.no",
      "s. no",
      "serial no",
      "serial no.",
      "sn",
      "sno",
      "s r. n o.",
      "excluded category",
      "excludedcategory",
      "ai relevance",
      "ai relevance valid",
      "ai relevance reason",
      "searchkey",
      "ready",
      "remark",
      "quotationno",
      "quotation no",
    ]);
    const seen = new Set<string>();
    let cols = [...tenderData.columns].filter((col) => {
      const normalized = col.toLowerCase().trim().replace(/\s+/g, " ");
      if (skipCols.has(normalized)) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    const indexMap = new Map(
      columnIndices.map((idx) => [normalizeKey(idx.columnName), idx]),
    );
    cols.sort((a, b) => {
      const ia = indexMap.get(normalizeKey(a));
      const ib = indexMap.get(normalizeKey(b));
      if (ia && ib) {
        const orderDiff = ia.displayOrder - ib.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return (
          new Date(ia.createdAt).getTime() - new Date(ib.createdAt).getTime()
        );
      }
      if (ia) return -1;
      if (ib) return 1;
      return 0;
    });

    const prev = prevOrderedColsRef.current;
    if (prev.length !== cols.length || prev.some((c, i) => c !== cols[i])) {
      prevOrderedColsRef.current = cols;
    }
    return cols;
  }, [tenderData, columnIndices]);

  const [filteredRows, setFilteredRows] = useState<Record<string, unknown>[]>(
    [],
  );
  const handleFilteredRowsChange = useCallback(
    (rows: Record<string, unknown>[]) => {
      setFilteredRows(rows);
    },
    [],
  );

  const [showExclusionDropdown, setShowExclusionDropdown] = useState(false);
  const exclusionFilter = useAppSelector((s) => s.filters.exclusionFilter);
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );
  const analyticsFilter = useAppSelector((s) => s.filters.analyticsFilter);

  const setAssociationFilter = useCallback(
    (value: string | null) => {
      dispatch(setAssociationFilterAction(value));
    },
    [dispatch],
  );

  // Date range, exclusion, participation, association and analytics filtering
  // all happen in SQL now, so the page needs no further narrowing.
  const analyticsFilteredRows = pageRows as unknown as Record<string, unknown>[];

  const rowsWithMergedValues = useMemo(() => {
    if (mergedGroups.length === 0) return analyticsFilteredRows;
    return analyticsFilteredRows.map((row) => {
      const newRow = { ...row } as Record<string, unknown>;
      for (const g of mergedGroups) {
        if (g.fields.length >= 2) {
          const isConcatenated = g.separator.trim().length > 0;
          if (isConcatenated) {
            const parts = g.fields
              .map((f) => String(row[f as keyof typeof row] ?? ""))
              .filter(Boolean);
            newRow[g.label] = parts.join(g.separator);
          } else {
            const firstField = g.fields[0];
            const val = row[firstField as keyof typeof row];
            newRow[g.label] = val != null && val !== "" ? String(val) : "";
          }
        }
      }
      return newRow;
    });
  }, [analyticsFilteredRows, mergedGroups]);

  // Row indices address the current page, which is exactly what the update
  // thunks expect now that tenderData is the page.
  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    pageRows.forEach((r, i) => {
      map.set(`${String(r.type)}-${String(r.id)}`, i);
    });
    return map;
  }, [pageRows]);

  // One object per distinct filter combination. The equality check keeps the
  // identity stable across unrelated dispatches, so the effect below only
  // fires when something the server cares about actually changed.
  const query = useAppSelector(
    (s): TenderQuery =>
      selectTenderQuery(s, s.filters.participationFilters.length === 0),
    (a, b) => tenderQueryKey(a) === tenderQueryKey(b),
  );
  const queryKey = useMemo(() => tenderQueryKey(query), [query]);
  const loadedKeyRef = useRef<string | null>(null);
  const hasMetaRef = useRef(false);
  hasMetaRef.current = pageColumns.length > 0;

  const reload = useCallback(() => {
    dispatch(loadTenderPage({ query, includeMeta: !hasMetaRef.current }));
    dispatch(loadTenderSummary({ query }));
    loadedKeyRef.current = queryKey;
  }, [dispatch, query, queryKey]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (loadedKeyRef.current === queryKey) return;
    reloadRef.current();
  }, [queryKey]);

  useEffect(() => {
    if (!pageStale) return;
    dispatch(clearStale());
    reloadRef.current();
  }, [pageStale, dispatch]);

  const mergedLabels = useMemo(
    () => mergedGroups.map((g) => g.label),
    [mergedGroups],
  );

  const requestFacet = useCallback(
    (accessor: string) => {
      // Hardcoded-option columns (Available / Not Available, Yes / No, the
      // association list) never need a round trip.
      if (!needsFacetQuery(accessor, mergedLabels)) return;
      dispatch(loadTenderFacet({ query, column: accessor }));
    },
    [dispatch, query, mergedLabels],
  );

  // null means "no options fetched for this column", which is different from
  // "fetched and empty" - the table must not prune hardcoded options on null.
  const getFacetOptions = useCallback(
    (accessor: string): FilterOption[] | null => {
      const entry = pageFacets[accessor];
      if (!entry || entry.status !== "ready") return null;
      return entry.options.map((v) => ({ value: v, label: v }));
    },
    [pageFacets],
  );

  const loadAllFilteredRows = useCallback(
    async (cols: string[] | null) =>
      (await fetchAllFilteredTenderRows(query, cols)) as unknown as Record<
        string,
        unknown
      >[],
    [query],
  );

  const loadRowsForExport = useCallback(
    (cols: string[]) => loadAllFilteredRows(cols),
    [loadAllFilteredRows],
  );

  const loadRowsForAnalysis = useCallback(
    () =>
      loadAllFilteredRows([
        "tenderBrief",
        "itemCategory",
        "aiRelevanceValid",
        "referenceNo",
      ]),
    [loadAllFilteredRows],
  );

  const serverMode = useMemo(
    () => ({
      total: pageTotal,
      page: pageNumber,
      pageSize,
      sort: pageSort,
      loading: pageStatus === "loading",
      onPageChange: (p: number) => dispatch(setPage(p)),
      onPageSizeChange: (n: number) => dispatch(setPageSize(n)),
      onSortChange: (next: { column: string; direction: "asc" | "desc" } | null) =>
        dispatch(setSort(next)),
      getFacetOptions,
      requestFacet,
      getAllFilteredRows: loadRowsForExport,
    }),
    [
      pageTotal,
      pageNumber,
      pageSize,
      pageSort,
      pageStatus,
      dispatch,
      getFacetOptions,
      requestFacet,
      loadRowsForExport,
    ],
  );

  const sidebarAnalytics = useMemo(() => {
    if (!pageSummary) return null;
    const byId = new Map(pageSummary.personCounts.map((p) => [p.id, p.count]));
    return {
      aiYes: pageSummary.aiYes,
      aiYesUnallocated: pageSummary.aiYesUnallocated,
      apmYesAllocated: pageSummary.apmYesAllocated,
      apmYesUnallocated: pageSummary.apmYesUnallocated,
      personCounts: pageAssociations
        .map((a) => ({ ...a, count: byId.get(a.id) ?? 0 }))
        .filter((p) => p.count > 0),
    };
  }, [pageSummary, pageAssociations]);

  const columnDefs = useMemo(() => {
    if (!tenderDataRef.current) return [];

    const mergedFieldSet = new Set<string>();
    const mergedDefList: {
      label: string;
      separator: string;
      fields: string[];
      firstField: string;
    }[] = [];
    for (const g of mergedGroups) {
      if (g.fields.length >= 2) {
        for (const f of g.fields) mergedFieldSet.add(f);
        mergedDefList.push({ ...g, firstField: g.fields[0] });
      }
    }

    const indexMap = new Map(
      columnIndices.map((idx) => [normalizeKey(idx.columnName), idx]),
    );
    const filteredCols = orderedColumns.filter((c) => !mergedFieldSet.has(c));
    const individualDefs = filteredCols.map(
      (col): ColumnDef<Record<string, unknown>> => {
        const colLower = col.toLowerCase();
        const colIndex = indexMap.get(normalizeKey(col));

        if (col === "app" || col === "aps" || col === "apm") {
          return {
            header: col,
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 120,
            sortable: false,
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const val = String(row[col] ?? "");
              const isYes = val === "YES";
              const isNo = val === "NO";
              const rowIndex =
                rowIndexMap.get(`${String(row.type)}-${String(row.id)}`) ?? -1;
              const rowType = String(row.type ?? "");
              const rowId = String(row.id ?? "");
              const isUpdating = updatingCellsRef.current[`${rowIndex}-${col}`];

              return (
                <div className="flex gap-1 py-1">
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() =>
                      handleDecisionClick(col, rowIndex, rowType, rowId, "YES")
                    }
                    className={`w-7 h-7 rounded text-xs font-bold border-2 transition-colors cursor-pointer ${
                      isUpdating
                        ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground/80 border-border"
                        : isYes
                          ? "bg-green-500 text-white border-green-600"
                          : "bg-card text-muted-foreground/80 border-border hover:border-input"
                    }`}
                  >
                    {isUpdating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "Y"
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() =>
                      handleDecisionClick(col, rowIndex, rowType, rowId, "NO")
                    }
                    className={`w-7 h-7 rounded text-xs font-bold border-2 transition-colors cursor-pointer ${
                      isUpdating
                        ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground/80 border-border"
                        : isNo
                          ? "bg-red-500 text-white border-red-600"
                          : "bg-card text-muted-foreground/80 border-border hover:border-input"
                    }`}
                  >
                    {isUpdating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "N"
                    )}
                  </button>
                </div>
              );
            },
            filter: {
              type: "select" as const,
              options: [
                { value: "YES", label: "Yes" },
                { value: "NO", label: "No" },
                { value: "__blank__", label: "Blank" },
              ],
            },
          };
        }

        if (
          col.toLowerCase().trim().replace(/\s+/g, " ") === "quantity / size"
        ) {
          return {
            header: "Size",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            renderCell: (value, row) => {
              const str = value != null && value !== "" ? String(value) : "-";
              if (str === "-") return str;
              if (
                String((row as Record<string, unknown>)?.type ?? "") === "Gem"
              ) {
                return (
                  <div style={{ fontSize: "11px", lineHeight: "1.4" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {str}
                    </ReactMarkdown>
                  </div>
                );
              }
              let items: string[];
              if (Array.isArray(value)) {
                items = value.map(String);
              } else {
                try {
                  const parsed = JSON.parse(str);
                  items = Array.isArray(parsed) ? parsed.map(String) : [str];
                } catch {
                  items = [str];
                }
              }
              if (items.length <= 1) return str;
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {items.map((part, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#f1f3f4",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        border: "1px solid #dadce0",
                        width: "fit-content",
                        color: "#202124",
                      }}
                    >
                      {part}
                    </div>
                  ))}
                </div>
              );
            },
            sortValue: (value: unknown) => {
              const num = parseFloat(String(value ?? ""));
              return isNaN(num) ? String(value ?? "") : num;
            },
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
          };
        }

        if (col === "aiRelevanceValid") {
          return {
            header: "AI Relevance",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            sortable: false,
            searchable: false,
            filter: {
              type: "select" as const,
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
                { value: "not_analysed", label: "Not Analysed" },
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const valid = String(row.aiRelevanceValid ?? "");
              const reason = String(row.aiRelevanceReason ?? "");
              if (!valid) return <span className="text-muted-foreground/60">-</span>;
              const isYes = valid === "true";
              const hasFeedback = !!row.aiFeedbackCorrected;
              const feedbackKey = `${row.id}-${row.type === "Gem" ? "Gem" : "NonGem"}`;
              const isSaving = feedbackSavingRef.current[feedbackKey];
              return (
                <div className="relative group/cell">
                  <div className="">
                    <div
                      className="flex flex-col gap-0.5"
                      style={{
                        maxHeight: 70,
                        overflowY: "auto",
                        whiteSpace: "normal",
                      }}
                    >
                      <Badge
                        className={`inline-flex w-fit text-[10px] font-medium ${
                          isYes
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                            : "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100"
                        }`}
                      >
                        {isYes ? "YES" : "NO"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {reason}
                      </span>
                      {hasFeedback && (
                        <Badge className="inline-flex w-fit text-[10px] font-medium bg-red-50 text-red-600 border-red-200">
                          Feedback Given
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!hasFeedback && (
                    <button
                      className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
                      title="Provide Feedback"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canMutate()) return;
                        setFeedbackRow(row);
                      }}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-white" />
                      )}
                    </button>
                  )}
                </div>
              );
            },
          };
        }

        if (col === "aiRelevanceReason") {
          return {
            header: "AI Reason",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            hidden: true,
            sortable: false,
            searchable: false,
          };
        }

        if (col === "assignedTo") {
          return {
            header: "Assigned To",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            searchable: false,
            filter: {
              type: "select" as const,
              options: [
                ...(tenderDataRef.current?.associations ?? []).map((a) => ({
                  value: String(a.id),
                  label: a.name,
                })),
                { value: "__blank__", label: "Blank" },
              ],
            },
            sortValue: (value: unknown) => {
              const ids = String(value ?? "")
                .split(",")
                .filter(Boolean);
              return ids
                .map((id) => {
                  const a = (tenderDataRef.current?.associations ?? []).find(
                    (assoc) => assoc.id === parseInt(id),
                  );
                  return a?.name ?? "";
                })
                .filter(Boolean)
                .sort()
                .join(", ");
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const val = String(row[col] ?? "");
              const isAssigned = Boolean(val);
              const rowIndex =
                rowIndexMap.get(`${String(row.type)}-${String(row.id)}`) ?? -1;
              const rowType = String(row.type ?? "");
              const rowId = String(row.id ?? "");
              return (
                <Select
                  value={val}
                  disabled={isAssigned}
                  onValueChange={(v) => {
                    const ids = v ? [v] : [];
                    handleAssignmentChange(rowIndex, rowType, rowId, ids);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="assignment-select w-full"
                    title={
                      isAssigned
                        ? "Assignment is locked once a person is allocated"
                        : undefined
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="None">
                      {(value) => {
                        const ids = String(value ?? "")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        const names = ids
                          .map((id) => {
                            const a = (
                              tenderDataRef.current?.associations ?? []
                            ).find((assoc) => assoc.id === parseInt(id, 10));
                            return a?.name;
                          })
                          .filter(Boolean);
                        return (
                          <>
                            {names.length > 0 ? names.join(", ") : "None"}
                            {isAssigned && (
                              <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(tenderDataRef.current?.associations ?? []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            },
          };
        }

        if (col === "reasonForNotAPM") {
          const colIndex = indexMap.get(normalizeKey(col));
          return {
            header: displayNameMap[col] ?? "Reason for Not Approval",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: colIndex?.width ?? 220,
            hidden: colIndex ? !colIndex.visible : false,
            searchable: false,
            filter: {
              type: "select" as const,
              options: [
                ...REASON_FOR_NOT_APM_OPTIONS.map((v) => ({
                  value: v,
                  label: v,
                })),
                { value: "__blank__", label: "Blank" },
              ],
            },
            sortValue: (value: unknown) => String(value ?? ""),
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const val = String(row[col] ?? "");
              const rowId = String(row.id ?? "");
              const isSaving =
                !!updatingCellsRef.current[`${rowId}-reasonForNotAPM`];
              // Radix Select requires non-empty value; map empty DB value to sentinel
              const selectValue = val || "__clear__";
              return (
                <Select
                  value={selectValue}
                  disabled={isSaving}
                  onValueChange={(v) => {
                    if (!canMutate()) return;
                    const newVal = v === "__clear__" ? "" : (v ?? "");
                    if (newVal === val) return;
                    dispatch(
                      updateTenderReasonForNotAPM({
                        tenderMergedId: Number(rowId),
                        reasonForNotAPM: newVal,
                        oldReasonForNotAPM: val,
                      }),
                    )
                      .unwrap()
                      .then(() =>
                        toast.success(
                          newVal ? "Reason updated" : "Reason cleared",
                        ),
                      )
                      .catch((err: Error) =>
                        toast.error(err?.message || "Failed to update reason"),
                      );
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__clear__">—</SelectItem>
                    {REASON_FOR_NOT_APM_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            },
          };
        }

        if (col === "parseStatus") {
          const statusColors: Record<string, string> = {
            COMPLETED:
              "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
            FAILED:
              "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100",
            RATE_LIMITED:
              "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50",
            PROCESSING:
              "bg-brand-light text-signal border-signal/40 hover:bg-brand-light",
          };
          return {
            header: "Parse Status",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 150,
            filter: {
              type: "select" as const,
              options: [
                { value: "COMPLETED", label: "Completed" },
                { value: "FAILED", label: "Failed" },
                { value: "RATE_LIMITED", label: "Rate Limited" },
                { value: "PROCESSING", label: "Processing" },
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const status = String(row.parseStatus ?? "");
              const error = String(row.parseError ?? "");
              if (!status) return <span className="text-muted-foreground/60">-</span>;
              const colorClass =
                statusColors[status] ??
                "bg-muted text-muted-foreground border-border";
              return (
                <div className="flex flex-col gap-0.5" title={error}>
                  <Badge
                    className={`inline-flex w-fit text-[10px] font-medium ${colorClass}`}
                  >
                    {status}
                  </Badge>
                </div>
              );
            },
          };
        }

        if (col === "parseError") {
          return {
            header: "Parse Error",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            hidden: true,
            sortable: false,
            searchable: false,
          };
        }

        if (
          col === "itemSchedules" ||
          col === "proposedErpItemName" ||
          col === "proposedErpQuantity" ||
          col === "cva"
        ) {
          const widthMap: Record<string, number> = {
            itemSchedules: 220,
            proposedErpItemName: 250,
            proposedErpQuantity: 280,
            cva: 180,
          };
          return {
            header:
              col === "itemSchedules"
                ? "Item Schedule"
                : (displayNameMap[col] ?? formatColumnName(col)),
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: widthMap[col],
            searchable: false,
            hidden: false,
          };
        }

        if (col === "tenderFileUrl") {
          return {
            header: "Tender Document",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 250,
            filter: {
              type: "select" as const,
              options: [
                { value: "Available", label: "Available" },
                { value: "Not Available", label: "Not Available" },
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const filesRaw = row.tenderFiles as string | undefined;
              let allFiles: Record<string, string>[] = [];
              try {
                allFiles = filesRaw
                  ? (JSON.parse(filesRaw) as Record<string, string>[])
                  : [];
              } catch {
                allFiles = [];
              }
              const tenderDocFiles = allFiles.filter((f) => {
                const tags = (f as unknown as { tags?: string[] | string })
                  .tags;
                if (Array.isArray(tags)) return tags.includes("tenderDocument");
                if (typeof tags === "string") {
                  try {
                    return (JSON.parse(tags) as string[]).includes(
                      "tenderDocument",
                    );
                  } catch {
                    return false;
                  }
                }
                return false;
              });
              const hasFiles = tenderDocFiles.length > 0;
              const isSaving =
                updatingCellsRef.current[`${row.id}-tenderDocument`];

              return (
                <div className="relative group/cell h-full">
                  <div className="flex items-center h-full gap-1.5">
                    {hasFiles ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenAttachmentModal(tenderDocFiles);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-rose-100 border-2 border-rose-500 text-rose-500 px-3 py-1.5 text-xs font-medium hover:bg-rose-500 hover:text-rose-100 transition-colors cursor-pointer"
                        title="View tender documents"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Show Tender Documents
                      </button>
                    ) : (
                      <span className="text-muted-foreground/60">-</span>
                    )}
                    <button
                      className="opacity-0 group-hover/cell:opacity-100 transition-all w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer shrink-0"
                      title="Upload Tender Document"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canMutate()) return;
                        setDocumentUploadRow(row);
                      }}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      ) : (
                        <Pencil className="w-4 h-4 text-white" />
                      )}
                    </button>
                  </div>
                </div>
              );
            },
          };
        }

        if (col === "reportings") {
          return {
            header: "Reporting Officers",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            filter: {
              type: "select" as const,
              options: [{ value: "__blank__", label: "Blank" }],
            },
            sortValue: (value: unknown) => {
              if (!value) return "";
              try {
                const entries = JSON.parse(String(value));
                if (Array.isArray(entries) && entries.length > 0) {
                  return entries[0]?.officer ?? "";
                }
              } catch {}
              return "";
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const raw = String(row[col] ?? "");
              if (!raw) return <span className="text-muted-foreground/60">-</span>;
              let entries: {
                officer: string;
                address?: string;
                quantity?: string;
              }[];
              try {
                entries = JSON.parse(raw);
              } catch {
                return <span className="text-muted-foreground/60">-</span>;
              }
              if (!entries.length)
                return <span className="text-muted-foreground/60">-</span>;
              return (
                <div
                  className="flex flex-col gap-1 text-xs"
                  style={{
                    maxHeight: 80,
                    overflowY: "auto",
                    whiteSpace: "normal",
                  }}
                >
                  {entries.map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="font-medium">{e.officer}</span>
                      {e.quantity && (
                        <span className="text-muted-foreground">
                          qty: {e.quantity}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            },
          };
        }

        if (col === "website") {
          return {
            header: "Website",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            filter: {
              type: "select" as const,
              options: [
                { value: "Available", label: "Available" },
                { value: "Not Available", label: "Not Available" },
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const raw = String(row[col] ?? "");
              const websiteKey = `${row.id}-${row.type === "Gem" ? "Gem" : "NonGem"}-website`;
              const isSaving = updatingCellsRef.current[websiteKey];
              const urls = raw
                ? raw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
              return (
                <div className="relative group/cell h-full">
                  <div
                    className="h-full"
                    style={{
                      height: 70,
                      maxHeight: 70,
                      overflowY: "auto",
                      whiteSpace: "normal",
                    }}
                  >
                    {urls.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {urls.map((url, i) => (
                          <a
                            key={i}
                            href={
                              url.startsWith("http://") ||
                              url.startsWith("https://")
                                ? url
                                : `https://${url}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand underline hover:text-brand text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {url}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">-</span>
                    )}
                  </div>
                  <button
                    className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
                    title="Edit Website"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canMutate()) return;
                      setWebsiteEditRow(row);
                    }}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Pencil className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>
              );
            },
          };
        }

        if (col === "location") {
          return {
            header: "Location",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 200,
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
            sortValue: (value: unknown, row: Record<string, unknown>) => {
              const reportingsRaw = String(row.reportings ?? "");
              const addresses: string[] = [];
              const origLoc = String(value ?? "").trim();
              if (origLoc) addresses.push(origLoc);
              if (reportingsRaw) {
                try {
                  const entries = JSON.parse(reportingsRaw);
                  if (Array.isArray(entries)) {
                    entries.forEach((e: { address?: string }) => {
                      if (e.address && !addresses.includes(e.address)) {
                        addresses.push(e.address);
                      }
                    });
                  }
                } catch {}
              }
              return addresses.join(" | ");
            },
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const reportingsRaw = String(row.reportings ?? "");
              const addresses: string[] = [];
              const origLoc = String(row.location ?? "").trim();
              if (origLoc) addresses.push(origLoc);
              if (reportingsRaw) {
                try {
                  const entries = JSON.parse(reportingsRaw);
                  if (Array.isArray(entries)) {
                    entries.forEach((e: { address?: string }) => {
                      if (e.address && !addresses.includes(e.address)) {
                        addresses.push(e.address);
                      }
                    });
                  }
                } catch {}
              }
              if (addresses.length === 0) {
                return <span className="text-muted-foreground/60">-</span>;
              }
              return (
                <div
                  style={{
                    maxHeight: 80,
                    overflowY: "auto",
                    whiteSpace: "normal",
                  }}
                >
                  {addresses.join(" | ")}
                </div>
              );
            },
          };
        }

        if (col === "referenceNo") {
          return {
            header: displayNameMap[col] ?? "Reference No",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 170,
            searchable: true,
            frozen: true,
            renderCell: (_value: unknown, row: Record<string, unknown>) => {
              const val = String(_value ?? "");
              const apm = String(row.apm ?? "");
              const participated = String(row.participated ?? "");

              let badge: { label: string; className: string } | null = null;
              if (apm === "YES") {
                if (participated === "true") {
                  badge = {
                    label: "POST",
                    className:
                      "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
                  };
                } else if (participated === "false") {
                  badge = {
                    label: "NOT_PARTICIPATED",
                    className:
                      "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100",
                  };
                } else {
                  badge = {
                    label: "PRE",
                    className:
                      "bg-brand-light text-signal border-signal/40 hover:bg-brand-light",
                  };
                }
              }

              return (
                <div className="flex flex-col gap-1">
                  {val ? (
                    <span className="text-xs font-mono">{val}</span>
                  ) : (
                    <span className="text-muted-foreground/60">-</span>
                  )}
                  {badge && (
                    <Badge
                      className={`inline-flex w-fit text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </Badge>
                  )}
                </div>
              );
            },
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
          };
        }

        if (col === "type") {
          return {
            header: "Type",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 100,
            searchable: false,
            frozen: true,
            renderCell: (value: unknown) => {
              const val = String(value ?? "");
              if (!val) return <span className="text-muted-foreground/60">-</span>;
              const isGem = val === "Gem";
              return (
                <Badge
                  className={`text-[10px] font-medium ${
                    isGem
                      ? "bg-brand-light text-signal border-signal/40"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {val}
                </Badge>
              );
            },
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
          };
        }

        if (colLower.replace(/[\s_]/g, "") === "price") {
          return {
            header: displayNameMap["price"] ?? "Price",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 110,
            type: "custom",
            renderCell: (value: unknown, row: Record<string, unknown>) => {
              const v = String(value ?? "").trim();
              if (v) {
                const upper = v.toUpperCase();
                return (
                  <span
                    className={`price-basis-badge ${
                      upper === "VARIABLE" ? "variable" : "firm"
                    }`}
                  >
                    {v}
                  </span>
                );
              }
              const id = String(row.id ?? "");
              const isSaving = !!updatingCellsRef.current[`${id}-price`];
              return (
                <Select
                  value=""
                  disabled={isSaving}
                  onValueChange={(v) => {
                    const newVal = v ?? "";
                    dispatch(
                      updateTenderMergedField({
                        rowIndex: 0,
                        field: "price",
                        value: newVal,
                        tenderMergedId: Number(row.id),
                        oldValue: "",
                      }),
                    )
                      .unwrap()
                      .then(() => toast.success("Price updated"))
                      .catch((err: Error) =>
                        toast.error(err?.message || "Failed to update price"),
                      );
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="price-edit-select w-full"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="(Blank)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">(Blank)</SelectItem>
                    <SelectItem value="FIRM">FIRM</SelectItem>
                    <SelectItem value="VARIABLE">VARIABLE</SelectItem>
                  </SelectContent>
                </Select>
              );
            },
            filter: {
              type: "select" as const,
              options: [
                { value: "FIRM", label: "Firm" },
                { value: "VARIABLE", label: "Variable" },
                { value: "__blank__", label: "Blank" },
              ],
            },
          };
        }

        if (col === "publishedDate" || col === "assignedDate") {
          const isPublished = col === "publishedDate";
          return {
            header:
              displayNameMap[col] ??
              (isPublished ? "Published Date" : "Assigned Date"),
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 130,
            type: "date" as const,
            filter: { type: "dateRange" as const },
            sortValue: (value: unknown) => {
              if (!value) return null;
              const date = new Date(String(value));
              return isNaN(date.getTime()) ? String(value) : date.getTime();
            },
          };
        }

        if (col === "remarks") {
          return {
            header: displayNameMap[col] ?? "Remarks",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: colIndex?.width ?? 250,
            searchable: true,
            hidden: colIndex ? !colIndex.visible : false,
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (value: unknown, row: Record<string, unknown>) => {
              const isSaving = updatingCellsRef.current[`${row.id}-remarks`];
              return (
                <RemarksCell
                  value={value}
                  row={row}
                  isSaving={isSaving}
                  canEdit={canEditRemarks}
                  dispatch={dispatch}
                />
              );
            },
          };
        }

        if (col === "agentReport") {
          return {
            header: "Agent Report",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: 160,
            hidden: false,
            searchable: false,
            renderCell: (_value: unknown, row: Record<string, unknown>) => (
              <AgentReportCell
                value={row.agentReport}
                onOpen={handleOpenAgentReport}
              />
            ),
          };
        }

        if (col === "divisionOrDepartment") {
          return {
            header: displayNameMap[col] ?? "Division or Department",
            accessor: col as keyof Record<string, unknown>,
            defaultWidth: colIndex?.width ?? 220,
            hidden: colIndex ? !colIndex.visible : false,
            searchable: true,
            sortValue: (value: unknown) => String(value ?? ""),
            filter: {
              type: "select" as const,
              options: [
                ...(selectFilterOptions[col] ?? []),
                { value: "__blank__", label: "Blank" },
              ],
            },
            renderCell: (value: unknown) => (
              <DivisionOrDepartmentCell value={value} />
            ),
          };
        }

        let filterType: "select" | "dateRange" | undefined;

        if (
          colLower.includes("date") ||
          colLower.includes("deadline") ||
          colLower.includes("submission")
        ) {
          filterType = "dateRange";
        } else {
          filterType = "select";
        }

        const options = selectFilterOptions[col];
        const isRawMaterials =
          colLower.replace(/[\s_]/g, "") === "rawmaterials";
        return {
          header:
            col === "reason"
              ? "Reason for not participation"
              : (displayNameMap[col] ?? formatColumnName(col)),
          accessor: col as keyof Record<string, unknown>,
          defaultWidth:
            colIndex?.width ??
            (col === "id"
              ? 80
              : col === "deadline" || col === "reportings"
                ? 300
                : col === "rawMaterials"
                  ? 240
                  : 200),
          searchable:
            col === "deadline" ||
            col === "organization" ||
            col === "type" ||
            isRawMaterials
              ? false
              : undefined,
          hidden: colIndex !== undefined ? !colIndex.visible : true,
          frozen:
            col === "organization" ||
            col === "tenderBrief" ||
            col === "itemCategory" ||
            col === "size"
              ? true
              : undefined,
          sortValue:
            col === "deadline"
              ? (value: unknown) => {
                  if (!value) return null;
                  const date = new Date(String(value));
                  return isNaN(date.getTime()) ? String(value) : date.getTime();
                }
              : undefined,
          type: filterType === "dateRange" ? "date" : undefined,
          filter: isRawMaterials
            ? ({ type: "rawMaterials" } as const)
            : filterType === "select"
              ? {
                  type: "select" as const,
                  options: [
                    ...(options ?? []),
                    { value: "__blank__", label: "Blank" },
                  ],
                  ...(col === "organization"
                    ? { searchable: true as const }
                    : {}),
                }
              : filterType === "dateRange"
                ? { type: "dateRange" as const }
                : undefined,
        };
      },
    );

    const processedGroups = new Set<string>();
    const mergedDefs = mergedDefList
      .filter((g) => {
        const idx = orderedColumns.indexOf(g.firstField);
        const alreadyIn = processedGroups.has(g.label);
        processedGroups.add(g.label);
        return idx >= 0 && !alreadyIn;
      })
      .sort(
        (a, b) =>
          orderedColumns.indexOf(a.firstField) -
          orderedColumns.indexOf(b.firstField),
      )
      .map((g) => {
        const firstField = g.fields[0];
        const isConcatenated = g.separator.trim().length > 0;
        const isOrgDeptGroup =
          g.fields.includes("organization") &&
          g.fields.includes("departmentName");
        const isBriefCatGroup =
          g.fields.includes("tenderBrief") && g.fields.includes("itemCategory");
        const isSizeGroup = g.fields.includes("size");
        return {
          header: isConcatenated
            ? (displayNameMap[g.label] ?? g.label)
            : (displayNameMap[firstField] ?? firstField),
          accessor: g.label as keyof Record<string, unknown>,
          defaultWidth: 250,
          frozen:
            isOrgDeptGroup || isBriefCatGroup || g.fields.includes("size")
              ? true
              : undefined,
          filter: {
            type: "select" as const,
            options: [{ value: "__blank__", label: "Blank" }],
          },
          sortValue: (_: unknown, row: Record<string, unknown>) => {
            if (isConcatenated) {
              const parts = g.fields
                .map((f) => String(row[f as keyof typeof row] ?? ""))
                .filter(Boolean);
              return parts.join(g.separator);
            }
            return String(row[firstField as keyof typeof row] ?? "");
          },
          renderCell: (_: unknown, row: Record<string, unknown>) => {
            if (isOrgDeptGroup) {
              const org = String(row.organization ?? "");
              const dept = String(row.departmentName ?? "");
              if (!org && !dept)
                return <span className="text-muted-foreground/60">-</span>;
              return (
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-medium">{org || "-"}</span>
                  {dept && (
                    <span className="text-[11px] text-muted-foreground">{dept}</span>
                  )}
                </div>
              );
            }
            if (isSizeGroup) {
              const val = row[firstField as keyof typeof row];
              const str = val != null && val !== "" ? String(val) : "-";
              if (str === "-") return str;
              if (String(row.type ?? "") === "Gem") {
                return (
                  <div style={{ fontSize: "11px", lineHeight: "1.4" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {str}
                    </ReactMarkdown>
                  </div>
                );
              }
              let items: string[];
              if (Array.isArray(val)) {
                items = val.map(String);
              } else {
                try {
                  const parsed = JSON.parse(str);
                  items = Array.isArray(parsed) ? parsed.map(String) : [str];
                } catch {
                  items = [str];
                }
              }
              if (items.length <= 1) return str;
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {items.map((part, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#f1f3f4",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        border: "1px solid #dadce0",
                        width: "fit-content",
                        color: "#202124",
                      }}
                    >
                      {part}
                    </div>
                  ))}
                </div>
              );
            }
            if (isConcatenated) {
              const parts = g.fields
                .map((f) => String(row[f as keyof typeof row] ?? ""))
                .filter(Boolean);
              return parts.length > 0 ? parts.join(g.separator) : "-";
            }
            const val = row[firstField as keyof typeof row];
            return val != null && val !== "" ? String(val) : "-";
          },
          provenance: getProvenanceForFields(g.fields),
        } as ColumnDef<Record<string, unknown>>;
      });

    for (const def of individualDefs) {
      (def as ColumnDef<Record<string, unknown>>).provenance = getProvenance(
        String(def.accessor),
      );
    }

    const result: ColumnDef<Record<string, unknown>>[] = [];
    let mergedIdx = 0;
    let indivIdx = 0;
    const mergedByPos = mergedDefs.map((d) => {
      const firstField = mergedDefList[mergedDefs.indexOf(d)]!.firstField;
      return { def: d, pos: orderedColumns.indexOf(firstField) };
    });

    for (let i = 0; i < orderedColumns.length; i++) {
      while (
        mergedIdx < mergedByPos.length &&
        mergedByPos[mergedIdx].pos === i
      ) {
        result.push(mergedByPos[mergedIdx].def);
        mergedIdx++;
      }
      if (!mergedFieldSet.has(orderedColumns[i])) {
        result.push(individualDefs[indivIdx]);
        indivIdx++;
      }
    }
    while (mergedIdx < mergedByPos.length) {
      result.push(mergedByPos[mergedIdx].def);
      mergedIdx++;
    }

    result.sort((a, b) => {
      const keyA = normalizeKey(String(a.accessor));
      const keyB = normalizeKey(String(b.accessor));
      const idxA = indexMap.get(keyA);
      const idxB = indexMap.get(keyB);
      if (idxA && idxB) {
        const orderDiff = idxA.displayOrder - idxB.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return (
          new Date(idxA.createdAt).getTime() -
          new Date(idxB.createdAt).getTime()
        );
      }
      if (idxA) return -1;
      if (idxB) return 1;
      return 0;
    });

    return result;
  }, [
    orderedColumns,
    selectFilterOptions,
    rowIndexMap,
    handleDecisionClick,
    handleAssignmentChange,
    handleOpenAttachmentModal,
    displayNameMap,
    mergedGroups,
    columnIndices,
    canEditRemarks,
    canMutate,
    handleOpenAgentReport,
  ]);

  const extraToolbarActions = useMemo(
    () => (
      <>
        <div className="column-picker-container">
          <button
            className="export-btn"
            onClick={() => setShowExclusionDropdown((v) => !v)}
          >
            {exclusionFilter ? `Excluding: ${exclusionFilter}` : "Exclusions"}
          </button>
          {showExclusionDropdown && (
            <>
              <div
                className="column-picker-overlay"
                onClick={() => setShowExclusionDropdown(false)}
              />
              <div className="column-picker-dropdown" style={{ width: 180 }}>
                {[
                  { value: "cable", label: "Exclude cables" },
                  {
                    value: "conductors",
                    label: "Exclude conductors",
                  },
                  { value: "both", label: "Exclude both" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    className="column-picker-item"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      fontSize: 12,
                    }}
                    onClick={() => {
                      dispatch(
                        setExclusionFilter(
                          exclusionFilter === opt.value ? null : opt.value,
                        ),
                      );
                      setShowExclusionDropdown(false);
                    }}
                  >
                    {exclusionFilter === opt.value ? (
                      <Check size={12} className="inline mr-1" />
                    ) : null}
                    {opt.label}
                  </button>
                ))}
                {exclusionFilter && (
                  <button
                    className="column-picker-item"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      fontSize: 12,
                      borderTop: "1px solid var(--color-border)",
                      marginTop: 4,
                      paddingTop: 6,
                    }}
                    onClick={() => {
                      dispatch(setExclusionFilter(null));
                      setShowExclusionDropdown(false);
                    }}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {/* <button className="export-btn" onClick={handleSyncDockets} disabled={syncingDockets}>
          <Loader2 size={14} className={syncingDockets ? "animate-spin" : ""} />
          {syncingDockets ? " Syncing Dockets..." : " Sync Dockets"}
        </button> */}
        <ConfirmAnalysisDialog
          filteredRows={filteredRows}
          loadRows={loadRowsForAnalysis}
          isLoggedIn={isLoggedIn}
        />
        {feedbackRow && (
          <AiFeedbackDialog
            row={feedbackRow}
            isSaving={feedbackSaving[`${feedbackRow.id}-feedback`] ?? false}
            onSave={handleSaveFeedback}
            onClose={() => setFeedbackRow(null)}
          />
        )}
        {websiteEditRow && (
          <WebsiteEditDialog
            row={websiteEditRow}
            isSaving={updatingCells[`${websiteEditRow.id}-website`] ?? false}
            onSave={handleWebsiteSave}
            onClose={() => setWebsiteEditRow(null)}
          />
        )}
        {documentUploadRow && (
          <TenderDocumentUploadDialog
            row={documentUploadRow}
            isSaving={
              updatingCells[`${documentUploadRow.id}-tenderDocument`] ?? false
            }
            onSave={handleDocumentUpload}
            onClose={() => setDocumentUploadRow(null)}
          />
        )}
        <AttachmentModal
          isOpen={isAttachmentModalOpen}
          onClose={() => setIsAttachmentModalOpen(false)}
          files={selectedFiles}
        />
        <Sheet
          open={!!agentReportContent}
          onOpenChange={(o) => {
            if (!o) setAgentReportContent(null);
          }}
        >
          <SheetContent
            side="right"
            className="sm:max-w-full! w-full"
            style={{ width: "40vw" }}
          >
            <SheetHeader>
              <SheetTitle>Agent Report</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1 [&_p]:mb-2 [&_p]:leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {agentReportContent ?? ""}
              </ReactMarkdown>
            </div>
          </SheetContent>
        </Sheet>
      </>
    ),
    [
      exclusionFilter,
      showExclusionDropdown,
      syncingDockets,
      filteredRows,
      feedbackRow,
      feedbackSaving,
      websiteEditRow,
      documentUploadRow,
      agentReportContent,
      isAttachmentModalOpen,
      selectedFiles,
      updatingCells,
      handleSyncDockets,
      handleSaveFeedback,
      handleWebsiteSave,
      handleDocumentUpload,
      dispatch,
      isLoggedIn,
    ],
  );

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      <TenderSidebar
        rows={filteredRows}
        analytics={sidebarAnalytics}
        associations={tenderData?.associations ?? []}
        associationFilter={associationFilter}
        onAssociationFilterChange={setAssociationFilter}
        isLoggedIn={isLoggedIn}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex flex-1 flex-col overflow-auto p-4">
          {loadingFiles && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/80">
              <Loader2 className="size-5 animate-spin mr-2 text-muted-foreground" />
              Loading files...
            </div>
          )}

          {loadingTenders && <DashboardSkeleton />}

          {!loadingTenders && tenderData && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <OptimizedTenderTable
                server={serverMode}
                onFilteredRowsChange={handleFilteredRowsChange}
                onParseComplete={refreshTenders}
                extraToolbarActions={extraToolbarActions}
                columns={columnDefs}
                rows={rowsWithMergedValues as Record<string, unknown>[]}
                associations={tenderData.associations ?? []}
                disableDefaultDeadlineFilter={participationFilters.length > 0}
                title="Tenders"
              />
            </div>
          )}

          {!loadingFiles &&
            !tenderData &&
            !loadingTenders &&
            (isLoggedIn ? (
              <DataEmptyState
                label="No tenders yet"
                description="Upload tender files from the sidebar to see them here."
              />
            ) : (
              <DataEmptyState
                label="Sign in to view tenders"
                description="Tender data is only available to signed-in users."
                action={
                  <Button size="sm" onClick={() => signIn()}>
                    <LogIn /> Sign in
                  </Button>
                }
              />
            ))}
        </main>
      </div>
    </div>
  );
}
