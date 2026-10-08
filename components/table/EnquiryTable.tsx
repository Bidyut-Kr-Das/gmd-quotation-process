"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, ChevronDown, ChevronRight, Search, Download, Upload, Edit2, Sparkles, Percent, Plus, RefreshCw, DollarSign, Trash2, X, PackageCheck, ExternalLink, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import ActionsDropdown from "./ActionsDropdown";
import Pagination from "./Pagination";
import MultiSelectFilter, { BLANK, AVAILABLE } from "./MultiSelectFilter";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import DebouncedSearchInput from "./DebouncedSearchInput";
import { selectAllEnquiries, selectAllItems, updateEnquiryField, updateItemField, addAttachments, fetchItemCodes, updateProductCost, update2to1Cost, updateAllBomCosts, fetchContractReviewRates, populatePdCostValidation, deleteEnquiryItems, deleteEnquiry, bulkUpdateValidation, bulkUpdateApm, clearQuotedRates, selectBomId, syncAvailableStock } from "@/lib/enquiriesSlice";
import { setFilter, resetFilters } from "@/lib/filtersSlice";
import { matchesGlobalSearch, itemDeletedStatus, DELETED_STATUS_OPTIONS } from "@/lib/filterUtils";
import { setPage, setPageSize, resetPage } from "@/lib/paginationSlice";
import { toggleRow, setRowExpanded, setColumnWidth, setExpandedRows, DEFAULT_COLUMN_WIDTHS, setGeneratedImages } from "@/lib/uiSlice";
import type { DropdownOptions, EnquiryData, EnquiryItemData, FiltersState } from "@/lib/types";
import { generateOfferPdfAction } from "@/lib/generate-offer-pdf";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { useSession } from "next-auth/react";
import { oneClickAccess, FROZEN_ITEM_FIELD_SET, isEnquiryFrozen } from "@/lib/oneClickAccess";
import { importExcelData, autoFillBlanks, updateVaPercent } from "@/lib/enquiriesSlice";
import { validateVaPercent } from "@/lib/vaValidation";
import { parseAndValidateContractNumbers } from "@/lib/contractValidation";
import { makeImageKey } from "@/lib/imageKey";
import { RM_TYPE_OPTIONS } from "@/lib/gmd_lib/sheet-columns";
import { C_BATCH_VALUE } from "@/lib/gmd_lib/verify-bom-columns";
import { N_BATCH_VALUE } from "@/lib/gmd_lib/contract-review-columns";
import { correctItemType } from "@/lib/itemTypePatterns";
import { isInternalEmail } from "@/lib/enquiryEmailParty";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatIndianNumber, cleanNumberInput, hasNumberChanged } from "@/lib/formatCurrency";

interface EnquiryTableProps {
  dropdownOptions: DropdownOptions;
  autoSentDockets?: string[];
  autoPendingDockets?: string[];
}

// Helper to extract company name and branch
function parseParty(partyName: string) {
  const parts = partyName.split(",").map((s) => s.trim());
  return {
    company: parts[0] || "",
    branch: parts.slice(1).join(", ") || null,
  };
}

// Helper to generate initials for avatar
function getInitials(name: string) {
  const { company } = parseParty(name);
  const cleanName = company
    .replace(/[^a-zA-Z0-9\s]/g, "") // remove special chars
    .replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt)\b/gi, "")
    .trim();

  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return "EQ";
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || value === "-";
}

function isBlankSize(value: unknown): boolean {
  return isBlankValue(value) || value === "Not detectable" || value === "Not mentioned/cant detect size";
}

export function getPdCostValidation(item: EnquiryItemData): string | null {
  if (item.contractReviewRate && item.productCost != null) {
    const cr = parseFloat(String(item.contractReviewRate).replace(/,/g, ""));
    const pc = Number(item.productCost);
    if (!isNaN(cr) && !isNaN(pc) && pc !== 0) {
      const val = ((cr - pc) / pc) * 100;
      return `${val.toFixed(2)}%`;
    }
  }

  const pdCostValidation = (item as unknown as Record<string, unknown>)?.pdcostValidation;
  return typeof pdCostValidation === "string" ? pdCostValidation : null;
}

function matchesMulti(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (Array.isArray(actual)) {
    if (values.includes(BLANK) && (actual.length === 0 || actual.every((v) => blankCheck(v)))) return true;
    return actual.some((v) => values.includes(String(v)));
  }
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  return values.includes(actual as string);
}

function isBlankOthers(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isBlankValue(value);
}

// Case-insensitive variant — used for fields like closureStatus where casing is inconsistent
function matchesMultiCI(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  const actualLower = typeof actual === "string" ? actual.toLowerCase() : null;
  return values.some((v) => v.toLowerCase() === actualLower);
}

// contractNo filter states: blank = no candidate contracts (contractNo empty);
// available = candidates exist but none selected (selectedContractNo empty);
// specific values match user-selected contracts.
function contractNoMatches(filterValue: string[], enquiry: EnquiryData): boolean {
  if (!filterValue || filterValue.length === 0) return true;
  const candidates = enquiry.contractNo ?? [];
  const selected = (enquiry as any).selectedContractNo ?? [];
  const specific = filterValue.filter((v) => v !== BLANK && v !== AVAILABLE);
  if (filterValue.includes(BLANK) && candidates.length === 0) return true;
  if (filterValue.includes(AVAILABLE) && candidates.length > 0 && selected.length === 0) return true;
  if (specific.length === 0) return false;
  return matchesMulti(specific, selected);
}

// Helper for cascading filter evaluation
function itemFieldMatches(item: EnquiryItemData, field: string, filterValue: string[]): boolean {
  const blankCheck = field === "size" ? isBlankSize : field === "others" ? isBlankOthers : isBlankValue;
  const val = field === "pdcostValidation" ? getPdCostValidation(item) : (item as any)[field as keyof EnquiryItemData];
  if (Array.isArray(val)) {
    return matchesMulti(filterValue, val, blankCheck);
  }
  const actual = val != null ? String(val) : null;
  return matchesMulti(filterValue, actual, blankCheck);
}

function enquiryFieldMatches(enquiry: EnquiryData, field: string, filterValue: string[]): boolean {
  if (field === "closureStatus") return matchesMultiCI(filterValue, enquiry[field as keyof EnquiryData]);
  if (field === "contractNo") return contractNoMatches(filterValue, enquiry);
  return matchesMulti(filterValue, enquiry[field as keyof EnquiryData]);
}

function matchesText(filterVal: string, actual: unknown): boolean {
  if (!filterVal) return true;
  if (actual == null) return false;
  return String(actual).toLowerCase().includes(filterVal.toLowerCase());
}

const ALL_DROPDOWN_FIELDS = [
  "enquiryType", "state", "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "closureStatus", "apm",
  "itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass", "others",
  "validation", "vaPercent", "erpItemCode", "bomId", "productCost", "costRefCode", "cost", "contractReviewRate", "pdcostValidation", "availableStock", "rmType", "deliverySchedule",
  "contractNo", "itemNameMerge",
] as const;

const ENQUIRY_DROPDOWN_SET = new Set(["enquiryType", "state", "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "closureStatus", "apm", "contractNo"]);

// One header filter box. Owning its own Redux read and its own debounce keeps every
// keystroke inside this leaf instead of re-rendering the whole table body.
function FilterTextInput({
  field,
  className,
  placeholder = "Search...",
  type,
}: {
  field: keyof FiltersState;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  const dispatch = useAppDispatch();
  const value = useAppSelector((s) => (s.filters[field] as string) || "");
  const onCommit = useCallback(
    (val: string) => dispatch(setFilter({ field, value: val })),
    [dispatch, field]
  );
  return (
    <DebouncedSearchInput
      value={value}
      onCommit={onCommit}
      placeholder={placeholder}
      className={className}
      type={type}
    />
  );
}

function OthersInlineMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const safeValue = Array.isArray(value) ? value : [];
  const safeOptions = options && options.length > 0 ? options : ["flange", "gasket", "nut and bolt"];
  const toggle = (opt: string) => {
    const next = safeValue.includes(opt) ? safeValue.filter((v) => v !== opt) : [...safeValue, opt];
    onChange(next);
  };
  const display = safeValue.length === 0 ? "-" : safeValue.join(", ");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[26px] rounded border border-border bg-background px-1.5 py-1 text-[10px] text-left truncate hover:bg-accent flex items-center justify-between gap-1"
        title={display}
      >
        <span className="truncate flex-1">{display}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-7 left-0 z-50 w-48 rounded border border-border bg-popover shadow-lg p-2 flex flex-col gap-1 max-h-48 overflow-auto">
            {safeOptions.map((opt) => {
              const checked = safeValue.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-2 text-[11px] cursor-pointer hover:bg-accent px-1 py-1 rounded">
                  <input type="checkbox" checked={checked} onChange={() => toggle(opt)} className="h-3 w-3 rounded border-border" />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}
            <div className="flex justify-between pt-1 border-t border-border mt-1">
              <button type="button" onClick={() => { onChange([]); setOpen(false); }} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-blue-600 dark:text-blue-300 font-bold hover:underline">Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemImageCells({
  item,
  image,
}: {
  item: EnquiryItemData | null;
  image: { url: string | null; driveFileId: string | null } | null;
}) {
  return (
    <>
      {/* View Image */}
      <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
        {item ? (
          image ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-10 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {image.driveFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://drive.google.com/thumbnail?id=${image.driveFileId}&sz=w400`}
                    alt={item.itemName || "item"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <ImageIcon size={14} className="text-muted-foreground" />
                )}
              </div>
              {image.url ? (
                <a
                  href={image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline shrink-0"
                >
                  View <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground italic">
              <ImageIcon size={12} /> No image
            </span>
          )
        ) : (
          "-"
        )}
      </td>
    </>
  );
}

/* Item Code (read-only). An item whose ERP item master status is C is closed, so the
   cell says so instead of showing the code; the real code stays in the title. Shared by
   the enquiry row (first item) and the expanded sub-rows so both mark closed items. */
function ItemCodeCell({ item }: { item?: EnquiryItemData }) {
  if (!item) {
    return (
      <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
        <span className="block text-[10px] text-muted-foreground p-1 font-mono">-</span>
      </td>
    );
  }
  return (
    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
      {item.nBatch === N_BATCH_VALUE ? (
        <span
          title={`${item.erpItemCode || ""} - NOT in CURRENT REQT on the GMD Item Creation Form`}
          className="block text-[10px] font-semibold italic text-amber-700 dark:text-amber-300 p-1 truncate"
        >
          Deleted as Current Reqt = No
        </span>
      ) : item.cBatch === C_BATCH_VALUE ? (
        <span
          title={`${item.erpItemCode || ""} - closed in ITEM MASTER ERP (ITEM_STATUS = C)`}
          className="block text-[10px] font-semibold italic text-rose-700 dark:text-rose-300 p-1 truncate"
        >
          Deleted as Closed
        </span>
      ) : (
        <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={item.erpItemCode || ""}>
          {item.erpItemCode || "-"}
        </span>
      )}
    </td>
  );
}

export default function EnquiryTable({ dropdownOptions, autoSentDockets, autoPendingDockets }: EnquiryTableProps) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEditApm = role === "admin" || role === "developer";
  const dispatch = useAppDispatch();
  const enquiries = useAppSelector(selectAllEnquiries);
  const autoSentSet = useMemo(() => new Set(autoSentDockets ?? []), [autoSentDockets]);
  const autoPendingSet = useMemo(() => new Set(autoPendingDockets ?? []), [autoPendingDockets]);
  const allItems = useAppSelector(selectAllItems);
  const filters = useAppSelector((s) => s.filters);
  const { currentPage, pageSize } = useAppSelector((s) => s.pagination);
  const expandedRows = useAppSelector((s) => s.ui.expandedRows);
  const columnWidths = useAppSelector((s) => s.ui.columnWidths);
  const globalSearch = filters.globalSearch.trim();

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [editingPartyEnquiryId, setEditingPartyEnquiryId] = useState<string | null>(null);

  const attachInputRefs = useRef<Record<string, HTMLInputElement>>({});
  const tableRef = useRef<HTMLTableElement>(null);

  const handleAddAttachments = async (e: React.ChangeEvent<HTMLInputElement>, enquiryId: string) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    e.target.value = "";
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          size: file.size,
          type: file.type || file.name.split(".").pop() || "",
          content: await fileToBase64(file),
        }))
      );
      toast.promise(
        (async () => {
          await dispatch(addAttachments({ enquiryId, attachments: payload })).unwrap();
        })(),
        {
          loading: "Uploading attachments...",
          success: "Attachments added successfully.",
          error: (err) => err.message,
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add attachments.");
    }
  };

  // Debounced filter inputs
  const [filterProjectReference, setFilterProjectReference] = useState("");
  const [filterAttachment, setFilterAttachment] = useState("");
  const [editingItemNameId, setEditingItemNameId] = useState<string | null>(null);
  const [autoFillStatus, setAutoFillStatus] = useState<"idle" | "running">("idle");
  const [vaStatus, setVaStatus] = useState<"idle" | "running">("idle");
  const [fetchCodesStatus, setFetchCodesStatus] = useState<"idle" | "running">("idle");
  const [updateCostStatus, setUpdateCostStatus] = useState<"idle" | "running">("idle");
  const [crRateStatus, setCrRateStatus] = useState<"idle" | "running">("idle");
  const [pdCostValStatus, setPdCostValStatus] = useState<"idle" | "running">("idle");
  const [syncStockStatus, setSyncStockStatus] = useState<"idle" | "running">("idle");
  // Docket No header filter: show only pending dockets (auto-created, no items yet).
  const [pendingOnly, setPendingOnly] = useState(false);
  // Bulk delete selection: per enquiry constraint, filtered scope, persisted across pagination
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [addingContractFor, setAddingContractFor] = useState<string | null>(null);

  // Image lookup: GeneratedImage rows keyed by imageKey (itemType__operationType__rmType).
  // Fetched once from the same endpoint the Upload Image dashboard uses; stored in Redux so cards can react.
  const imageMap = useAppSelector((s) => s.ui.generatedImages);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/generated-images", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json) => {
        if (cancelled) return;
        const map: Record<string, { url: string | null; driveFileId: string | null }> = {};
        for (const it of json.items ?? []) {
          if (it.url || it.driveFileId) {
            map[it.imageKey] = { url: it.url ?? null, driveFileId: it.driveFileId ?? null };
          }
        }
        dispatch(setGeneratedImages(map));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const getItemImage = useCallback(
    (item: EnquiryItemData) => {
      if (!item.itemType || !item.operationType || !item.rmType) return null;
      const img = imageMap[makeImageKey(item.itemType, item.operationType, item.rmType)];
      if (!img || (!img.url && !img.driveFileId)) return null;
      return img;
    },
    [imageMap]
  );

  // Reset pagination to first page when filters change
  useEffect(() => {
    dispatch(resetPage());
  }, [filters, dispatch]);

  // Derive the effective selection instead of synchronizing it in an effect:
  // ids/enquiry that no longer exist (after delete) are pruned during render, which
  // avoids the cascading re-render of setState-in-effect.
  const validSelectedItemIds = useMemo(() => {
    if (selectedItemIds.size === 0) return selectedItemIds;
    const existingIds = new Set(allItems.map((i) => i.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedItemIds) {
      if (existingIds.has(id)) next.add(id);
      else changed = true;
    }
    return changed ? next : selectedItemIds;
  }, [allItems, selectedItemIds]);

  const validSelectedEnquiryId = useMemo(
    () =>
      selectedEnquiryId && enquiries.some((e) => e.id === selectedEnquiryId)
        ? selectedEnquiryId
        : null,
    [enquiries, selectedEnquiryId]
  );

  const isItemSelected = (itemId: string) => validSelectedItemIds.has(itemId);

  const toggleItemSelection = (enquiryId: string, itemId: string) => {
    if (validSelectedEnquiryId && validSelectedEnquiryId !== enquiryId) {
      const prevDocket = enquiries.find((e) => e.id === validSelectedEnquiryId)?.docketNumber || validSelectedEnquiryId;
      const nextDocket = enquiries.find((e) => e.id === enquiryId)?.docketNumber || enquiryId;
      if (!confirm(`Selection is currently for docket "${prevDocket}". Clear selection and select items from "${nextDocket}" instead?`)) return;
      setSelectedEnquiryId(enquiryId);
      setSelectedItemIds(new Set([itemId]));
      return;
    }
    const next = new Set(validSelectedItemIds);
    if (next.has(itemId)) {
      next.delete(itemId);
      if (next.size === 0) setSelectedEnquiryId(null);
    } else {
      next.add(itemId);
      setSelectedEnquiryId(enquiryId);
    }
    setSelectedItemIds(next);
  };

  const toggleSelectAllForEnquiry = (enquiry: EnquiryData, filteredItems: EnquiryItemData[]) => {
    const ids = filteredItems.map((i) => i.id);
    if (ids.length === 0) return;
    if (validSelectedEnquiryId && validSelectedEnquiryId !== enquiry.id) {
      const prevDocket = enquiries.find((e) => e.id === validSelectedEnquiryId)?.docketNumber || validSelectedEnquiryId;
      if (!confirm(`Selection is currently for docket "${prevDocket}". Clear and select all ${ids.length} items from "${enquiry.docketNumber}"?`)) return;
      setSelectedEnquiryId(enquiry.id);
      setSelectedItemIds(new Set(ids));
      return;
    }
    const allSelected = ids.every((id) => validSelectedItemIds.has(id));
    if (allSelected) {
      const next = new Set(validSelectedItemIds);
      ids.forEach((id) => next.delete(id));
      setSelectedItemIds(next);
      if (next.size === 0) setSelectedEnquiryId(null);
    } else {
      setSelectedEnquiryId(enquiry.id);
      const next = new Set(validSelectedItemIds);
      ids.forEach((id) => next.add(id));
      setSelectedItemIds(next);
    }
  };

  const clearSelection = () => {
    setSelectedEnquiryId(null);
    setSelectedItemIds(new Set());
  };

  const handleBulkDeleteConfirm = async () => {
    if (validSelectedItemIds.size === 0 || !validSelectedEnquiryId) return;
    const ids = Array.from(validSelectedItemIds);
    setBulkDeleting(true);
    try {
      await dispatch(deleteEnquiryItems(ids)).unwrap();
      toast.success(`Deleted ${ids.length} item(s) successfully.`);
      clearSelection();
      setBulkConfirmOpen(false);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to delete selected items.";
      toast.error(msg);
    } finally {
      setBulkDeleting(false);
    }
  };

  const [clearQrRunning, setClearQrRunning] = useState(false);
  const [clearQrConfirmOpen, setClearQrConfirmOpen] = useState(false);
  const [clearQrPending, setClearQrPending] = useState<{ total: number; withQr: number; ids: string[] } | null>(null);
  const handleClearQr = () => {
    const allFiltered = filteredEnquiries.flatMap((e) => getFilteredItems(e));
    if (allFiltered.length === 0) {
      toast.info("No items match current filters.");
      return;
    }
    // Exclude frozen enquiries — rate & cost are frozen after one-time PDF
    const frozenEnquiryIds = new Set(
      filteredEnquiries
        .filter((e) => isEnquiryFrozen((e as any).apm, (e as any).offerPdfGeneratedAt))
        .map((e) => e.id)
    );
    const nonFrozenFiltered = allFiltered.filter((i) => !frozenEnquiryIds.has(i.enquiryId));
    if (frozenEnquiryIds.size > 0) {
      const frozenCount = allFiltered.length - nonFrozenFiltered.length;
      if (nonFrozenFiltered.length === 0) {
        toast.info(`Cannot clear rates: ${frozenCount} item(s) are frozen after one-time PDF generation — revert APM to edit.`);
        return;
      }
      toast(`Skipping ${frozenCount} frozen item(s) (APM Yes + PDF generated).`, { duration: 3000 });
    }
    const withQr = nonFrozenFiltered.filter((i) => i.quotedRate != null && String(i.quotedRate).trim() !== "");
    if (withQr.length === 0) {
      toast.info("No Quoted Rates to clear for current filters.");
      return;
    }
    setClearQrPending({ total: nonFrozenFiltered.length, withQr: withQr.length, ids: withQr.map((i) => i.id) });
    setClearQrConfirmOpen(true);
  };
  const handleClearQrConfirm = async () => {
    if (!clearQrPending) return;
    setClearQrRunning(true);
    const toastId = toast.loading("Clearing quoted rates...");
    try {
      const result: any = await dispatch(clearQuotedRates(clearQrPending.ids)).unwrap();
      toast.success(`Cleared ${result.cleared} Quoted Rate(s). VA% preserved.`, { id: toastId });
      setClearQrConfirmOpen(false);
      setClearQrPending(null);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to clear quoted rates.";
      toast.error(msg, { id: toastId });
    } finally {
      setClearQrRunning(false);
    }
  };

  const [bulkValidationRunning, setBulkValidationRunning] = useState<"Yes" | "No" | "Clear" | null>(null);
  const handleBulkValidation = async (val: "Yes" | "No" | "") => {
    const allFiltered = filteredEnquiries.flatMap((e) => getFilteredItems(e));
    if (allFiltered.length === 0) {
      toast.info("No items match current filters.");
      return;
    }
    const label = val === "" ? "Blank" : val;
    const differing = allFiltered.filter((i) => (i.validation || "") !== (val || "")).length;
    if (!confirm(`Set validation to "${label}" for ${allFiltered.length} filtered item(s) across all pages?${differing > 0 ? ` This will overwrite ${differing} differing value(s).` : ""}`)) return;
    const runKey = val === "" ? "Clear" : val;
    setBulkValidationRunning(runKey as any);
    const toastId = toast.loading(`Setting validation to "${label}"...`);
    try {
      const result: any = await dispatch(bulkUpdateValidation({ itemIds: allFiltered.map((i) => i.id), validation: val === "" ? null : val })).unwrap();
      toast.success(`Validation set to "${label}" for ${result.updated} item(s).`, { id: toastId });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to update validation.";
      toast.error(msg, { id: toastId });
    } finally {
      setBulkValidationRunning(null);
    }
  };

  const [bulkApmRunning, setBulkApmRunning] = useState<"Yes" | "No" | "Clear" | null>(null);
  const handleBulkApm = async (val: "Yes" | "No" | "") => {
    if (!canEditApm) { toast.error("Admin or developer only can set APM — please login"); return; }
    if (filteredEnquiries.length === 0) {
      toast.info("No enquiries match current filters.");
      return;
    }
    const label = val === "" ? "Blank" : val;
    const differing = filteredEnquiries.filter((e) => ((e as any).apm || "") !== (val || "")).length;
    if (!confirm(`Set APM to "${label}" for ${filteredEnquiries.length} filtered enquir${filteredEnquiries.length === 1 ? "y" : "ies"} across all pages?${differing > 0 ? ` This will overwrite ${differing} differing value(s).` : ""}`)) return;
    const runKey = val === "" ? "Clear" : val;
    setBulkApmRunning(runKey as any);
    const toastId = toast.loading(`Setting APM to "${label}"...`);
    try {
      const result: any = await dispatch(bulkUpdateApm({ enquiryIds: filteredEnquiries.map((e) => e.id), apm: val === "" ? null : val })).unwrap();
      toast.success(`APM set to "${label}" for ${result.updated} enquir${result.updated === 1 ? "y" : "ies"}.`, { id: toastId });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to update APM.";
      toast.error(msg, { id: toastId });
    } finally {
      setBulkApmRunning(null);
    }
  };

  const cascadedOptions = useMemo(() => {
    const result: Record<string, string[]> = {};

    const enquiryPasses = (enquiry: EnquiryData, excludeField: string | null): boolean => {
      if (excludeField !== "partyNames" && filters.partyNames.length > 0) {
        if (!filters.partyNames.includes(enquiry.partyName)) return false;
      }
      for (const other of ALL_DROPDOWN_FIELDS) {
        if (other === excludeField) continue;
        if (ENQUIRY_DROPDOWN_SET.has(other)) {
          const val = filters[other as keyof FiltersState] as unknown as string[];
          if (val.length > 0 && !enquiryFieldMatches(enquiry, other, val)) return false;
        }
      }
      if (!matchesGlobalSearch(enquiry, globalSearch)) return false;
      // --- text filters at enquiry level ---
      if (excludeField !== "docketNumber" && filters.docketNumber && !matchesText(filters.docketNumber, enquiry.docketNumber)) return false;
      if (excludeField !== "enquiryDateFrom" && filters.enquiryDateFrom) {
        const from = new Date(filters.enquiryDateFrom);
        if (new Date(enquiry.enquiryDate) < from) return false;
      }
      if (excludeField !== "enquiryDateTo" && filters.enquiryDateTo) {
        const to = new Date(filters.enquiryDateTo);
        const limit = new Date(to); limit.setDate(limit.getDate()+1);
        if (new Date(enquiry.enquiryDate) > limit) return false;
      }
      if (excludeField !== "projectReference" && filterProjectReference && !matchesText(filterProjectReference, enquiry.projectReference || "")) return false;
      if (excludeField !== "emailAddress" && filters.emailAddress && !matchesText(filters.emailAddress, enquiry.senderEmail || "")) return false;
      if (excludeField !== "contactNo" && filters.contactNo && !matchesText(filters.contactNo, enquiry.contactNo || "")) return false;
      if (excludeField !== "attachment" && filters.attachment) {
        if (!enquiry.attachments || enquiry.attachments.length===0) return false;
        const match = enquiry.attachments.some((a)=> a.name.toLowerCase().includes(filters.attachment.toLowerCase()));
        if (!match) return false;
      }
      return true;
    };

    const itemPasses = (item: EnquiryItemData, excludeField: string | null): boolean => {
      for (const other of ALL_DROPDOWN_FIELDS) {
        if (other === excludeField) continue;
        if (!ENQUIRY_DROPDOWN_SET.has(other)) {
          const val = filters[other as keyof FiltersState] as unknown as string[];
          if (val.length > 0 && !itemFieldMatches(item, other, val)) return false;
        }
      }
      // --- item text filters ---
      if (excludeField !== "itemName" && filters.itemName && !matchesText(filters.itemName, item.itemName)) return false;
      if (excludeField !== "quantity" && filters.quantity && !matchesText(filters.quantity, String(item.quantity))) return false;
      if (excludeField !== "itemTypeSearch" && filters.itemTypeSearch && !matchesText(filters.itemTypeSearch, item.itemType || "")) return false;
      if (excludeField !== "mocSearch" && filters.mocSearch && !matchesText(filters.mocSearch, item.moc || "")) return false;
      if (excludeField !== "erpItemCodeSearch" && filters.erpItemCodeSearch && !matchesText(filters.erpItemCodeSearch, item.erpItemCode || "")) return false;
      if (excludeField !== "bomIdSearch" && (filters.bomIdSearch as string) && !matchesText(filters.bomIdSearch, (item as unknown as Record<string,unknown>).bomId as string || "")) return false;
      if (excludeField !== "contractReviewRateSearch" && (filters.contractReviewRateSearch as string) && !matchesText(filters.contractReviewRateSearch, item.contractReviewRate || "")) return false;
      if (excludeField !== "pdcostValidationSearch" && (filters.pdcostValidationSearch as string) && !matchesText(filters.pdcostValidationSearch, getPdCostValidation(item) || "")) return false;
      if (excludeField !== "costRefCodeSearch" && filters.costRefCodeSearch && !matchesText(filters.costRefCodeSearch, item.costRefCode || "")) return false;
      if (excludeField !== "othersSearch" && (filters as any).othersSearch && !matchesText((filters as any).othersSearch, (item as any).others || "")) return false;
      if (excludeField !== "stockStatus" && filters.stockStatus && !matchesText(filters.stockStatus, item.stockStatus || "")) return false;
      if (excludeField !== "stockQuantity" && filters.stockQuantity && !matchesText(filters.stockQuantity, item.stockQuantity || "")) return false;
      if (excludeField !== "stockAgainstContract" && filters.stockAgainstContract && !matchesText(filters.stockAgainstContract, item.stockAgainstContract || "")) return false;
      if (excludeField !== "discount" && filters.discount && !matchesText(filters.discount, item.discount != null ? String(item.discount) : "")) return false;
      if (excludeField !== "quotedRate" && filters.quotedRate && !matchesText(filters.quotedRate, item.quotedRate || "")) return false;
      if (excludeField !== "quotedRateGst" && (filters.quotedRateGst as string) && !matchesText(filters.quotedRateGst, item.quotedRateGst || "")) return false;
      if (excludeField !== "itemNameMergeSearch" && filters.itemNameMergeSearch && !matchesText(filters.itemNameMergeSearch, item.itemNameMerge || "")) return false;
      if (excludeField !== "totalValue" && filters.totalValue && !matchesText(filters.totalValue, item.totalValue || "")) return false;
      if (excludeField !== "itemWiseTotalValue" && filters.itemWiseTotalValue && !matchesText(filters.itemWiseTotalValue, item.itemWiseTotalValue || "")) return false;
      // note: productCost/cost are dropdowns already handled
      return true;
    };

    for (const field of ALL_DROPDOWN_FIELDS) {
      if (ENQUIRY_DROPDOWN_SET.has(field)) {
        const available = enquiries
          .filter((enquiry) => {
            if (!enquiryPasses(enquiry, field)) return false;
            return enquiry.items.some((item) => itemPasses(item, field));
          })
          .flatMap((enquiry) => {
            const val = field === "contractNo"
              ? ((enquiry as any).selectedContractNo ?? [])
              : (enquiry as unknown as Record<string, unknown>)[field];
            if (Array.isArray(val)) return val.map(String).map((s) => s.trim()).filter((v) => v !== "" && v !== "undefined" && v !== "null");
            return val != null ? [String(val)] : [];
          })
          .filter((v) => v !== "" && v !== "undefined" && v !== "null")
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        result[field] = available;
      } else {
        const matchingEnquiryIds = new Set(
          enquiries
            .filter((enquiry) => enquiryPasses(enquiry, field))
            .map((e) => e.id)
        );
        const available = allItems
          .filter((item) => matchingEnquiryIds.has(item.enquiryId))
          .filter((item) => itemPasses(item, field))
          .flatMap((item) => {
            const val = (item as unknown as Record<string, unknown>)[field];
            if (Array.isArray(val)) return val.map(String).filter((v) => v !== "" && v !== "undefined" && v !== "null");
            return val != null ? [String(val)] : [];
          })
          .filter((v) => v !== "" && v !== "undefined" && v !== "null")
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        result[field] = available;
      }
    }

    const availableParties = enquiries
      .filter((enquiry) => {
        for (const other of ALL_DROPDOWN_FIELDS) {
          if (ENQUIRY_DROPDOWN_SET.has(other)) {
            const val = filters[other as keyof FiltersState] as unknown as string[];
            if (!enquiryFieldMatches(enquiry, other, val)) return false;
          }
        }
        // also respect text/global for parties
        if (!enquiryPasses(enquiry, "partyNames")) return false;
        return enquiry.items.some((item) => itemPasses(item, null));
      })
      .map((enquiry) => enquiry.partyName)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    result.partyNames = availableParties;

    return result;
  }, [enquiries, allItems, filters, filterProjectReference, globalSearch]);

  // Master unique list of all contract numbers selected across all enquiries
  const allSelectedContractOptions = useMemo(() => {
    const set = new Set<string>();
    for (const eq of enquiries) {
      for (const cn of (eq as any).selectedContractNo ?? []) {
        const trimmed = String(cn ?? "").trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [enquiries]);

  // VA% validation: compute set of item IDs where VA% exceeds allowed max
  const invalidVaItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of allItems) {
      const result = validateVaPercent(item.itemType, item.size, item.vaPercent);
      if (!result.isValid) ids.add(item.id);
    }
    return ids;
  }, [allItems]);



  // Auto-expand rows when docket number is searched - respects manual collapse
  useEffect(() => {
    if (filters.docketNumber) {
      const next: Record<string, boolean> = {};
      for (const enquiry of enquiries) {
        if (enquiry.docketNumber.toLowerCase().includes(filters.docketNumber.toLowerCase())) {
          if (expandedRows[enquiry.id] === undefined) {
            next[enquiry.id] = true;
          }
        }
      }
      if (Object.keys(next).length > 0) {
        dispatch(setExpandedRows(next));
      }
    }
  }, [filters.docketNumber, enquiries, expandedRows, dispatch]);

  // globalSearch is excluded on purpose: hasActiveFilters drives row auto-expansion, and
  // the search box never expanded rows back when it filtered server-side.
  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(([key, val]) => {
        if (key === "globalSearch") return false;
        if (Array.isArray(val)) return val.length > 0;
        return val !== "" && val !== "All";
      }),
    [filters]
  );

  const handleResetAllFilters = () => {
    dispatch(resetFilters());
    setPendingOnly(false);
    toast.success("All filters reset successfully.");
  };

  const activeDetailsFilterCount = useMemo(() => {
    let count = 0;
    if (filters.itemType && filters.itemType.length > 0) count++;
    if (filters.moc && filters.moc.length > 0) count++;
    if (filters.size && filters.size.length > 0) count++;
    if (filters.pnRating && filters.pnRating.length > 0) count++;
    if (filters.operationType && filters.operationType.length > 0) count++;
    if (filters.extension && filters.extension.length > 0) count++;
    if (filters.bypass && filters.bypass.length > 0) count++;
    if (filters.others && filters.others.length > 0) count++;
    if (filters.rmType && filters.rmType.length > 0) count++;
    return count;
  }, [filters]);

  const handleClearDetailsFilters = useCallback(() => {
    dispatch(setFilter({ field: "itemType", value: [] }));
    dispatch(setFilter({ field: "moc", value: [] }));
    dispatch(setFilter({ field: "size", value: [] }));
    dispatch(setFilter({ field: "pnRating", value: [] }));
    dispatch(setFilter({ field: "operationType", value: [] }));
    dispatch(setFilter({ field: "extension", value: [] }));
    dispatch(setFilter({ field: "bypass", value: [] }));
    dispatch(setFilter({ field: "others", value: [] }));
    dispatch(setFilter({ field: "rmType", value: [] }));
  }, [dispatch]);

  const activeStateUtilityFilterCount = useMemo(() => {
    let count = 0;
    if (filters.state && filters.state.length > 0) count++;
    if (filters.utility && filters.utility.length > 0) count++;
    return count;
  }, [filters]);

  const handleClearStateUtilityFilters = useCallback(() => {
    dispatch(setFilter({ field: "state", value: [] }));
    dispatch(setFilter({ field: "utility", value: [] }));
  }, [dispatch]);

  const activePaymentTermsFilterCount = useMemo(() => {
    let count = 0;
    if (filters.paymentTerms && filters.paymentTerms.length > 0) count++;
    if (filters.pbg && filters.pbg.length > 0) count++;
    if (filters.inspection && filters.inspection.length > 0) count++;
    return count;
  }, [filters]);

  const handleClearPaymentTermsFilters = useCallback(() => {
    dispatch(setFilter({ field: "paymentTerms", value: [] }));
    dispatch(setFilter({ field: "pbg", value: [] }));
    dispatch(setFilter({ field: "inspection", value: [] }));
  }, [dispatch]);

  const getFilteredItems = useCallback((enquiry: EnquiryData) => {
    if (!enquiry.items) return [];
    return enquiry.items.filter((item: EnquiryItemData) => {
      if (
        filters.itemName &&
        !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quantity &&
        !item.quantity.toString().includes(filters.quantity)
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemType, item.itemType)) {
        return false;
      }
      if (
        filters.itemTypeSearch &&
        !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.moc, item.moc)) {
        return false;
      }
      if (
        filters.mocSearch &&
        !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.size, item.size, isBlankSize)) {
        return false;
      }
      if (!matchesMulti(filters.pnRating, item.pnRating)) {
        return false;
      }
      if (!matchesMulti(filters.operationType, item.operationType)) {
        return false;
      }
      if (!matchesMulti(filters.extension, item.extension)) {
        return false;
      }
      if (!matchesMulti(filters.bypass, item.bypass)) {
        return false;
      }
      if (!matchesMulti((filters as any).others, (item as any).others, isBlankOthers)) {
        return false;
      }
      if (
        (filters as any).othersSearch &&
        !((item as any).others || "").toLowerCase().includes((filters as any).othersSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) {
        return false;
      }
      if (
        filters.erpItemCodeSearch &&
        !(item.erpItemCode || "").toLowerCase().includes(filters.erpItemCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.bomId as any, (item as any).bomId)) {
        return false;
      }
      if (
        filters.bomIdSearch &&
        !((item as any).bomId || "").toLowerCase().includes(filters.bomIdSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) {
        return false;
      }
      if (!matchesMulti(filters.pdcostValidation, getPdCostValidation(item))) {
        return false;
      }
      if (
        filters.contractReviewRateSearch &&
        !(item.contractReviewRate || "").toLowerCase().includes(filters.contractReviewRateSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.pdcostValidationSearch &&
        !(getPdCostValidation(item) || "").toLowerCase().includes(filters.pdcostValidationSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.productCost.length > 0 &&
        !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)
      ) {
        return false;
      }
      if (!matchesMulti(filters.costRefCode, item.costRefCode)) {
        return false;
      }
      if (
        filters.costRefCodeSearch &&
        !(item.costRefCode || "").toLowerCase().includes(filters.costRefCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.cost.length > 0 &&
        !matchesMulti(filters.cost, item.cost != null ? String(item.cost) : null)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !(item.stockStatus || "").toLowerCase().includes(filters.stockStatus.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.stockQuantity &&
        !(item.stockQuantity || "").toLowerCase().includes(filters.stockQuantity.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.availableStock.length > 0 &&
        !matchesMulti(filters.availableStock, item.availableStock ?? null)
      ) {
        return false;
      }
      if (
        filters.rmType.length > 0 &&
        !matchesMulti(filters.rmType, item.rmType ?? null)
      ) {
        return false;
      }
      if (
        filters.deliverySchedule.length > 0 &&
        !matchesMulti(filters.deliverySchedule, item.deliverySchedule ?? null)
      ) {
        return false;
      }
      if (
        filters.stockAgainstContract &&
        !(item.stockAgainstContract || "").toLowerCase().includes(filters.stockAgainstContract.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.discount &&
        !(item.discount?.toString() || "").includes(filters.discount)
      ) {
        return false;
      }
      if (
        filters.vaPercent.length > 0 &&
        !matchesMulti(filters.vaPercent, item.vaPercent?.toString() ?? null)
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemNameMerge, item.itemNameMerge)) {
        return false;
      }
      if (
        filters.itemNameMergeSearch &&
        !(item.itemNameMerge || "").toLowerCase().includes(filters.itemNameMergeSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.totalValue &&
        !(item.totalValue || "").includes(filters.totalValue)
      ) {
        return false;
      }
      if (
        filters.itemWiseTotalValue &&
        !(item.itemWiseTotalValue || "").includes(filters.itemWiseTotalValue)
      ) {
        return false;
      }
      if (filters.validation.length > 0) {
        if (!matchesMulti(filters.validation, item.validation)) {
          return false;
        }
      }
      if ((filters as any).image && (filters as any).image.length > 0) {
        const hasImg = !!getItemImage(item);
        const wantPresent = (filters as any).image.includes("Present");
        const wantBlank = (filters as any).image.includes(BLANK);
        if (wantPresent && !wantBlank && !hasImg) return false;
        if (wantBlank && !wantPresent && hasImg) return false;
      }
      if (!itemDeletedStatus(item, filters.deletedStatus)) return false;
      return true;
    });
  }, [filters, getItemImage]);

  const toggleExpand = (id: string, currentExpanded: boolean) => {
    dispatch(setRowExpanded({ id, expanded: !currentExpanded }));
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    dispatch(setPage(1));
  };

  const renderSortArrow = (field: string) => {
    const isSorted = sortField === field;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="ml-1 inline-flex items-center justify-center hover:bg-muted/50 rounded cursor-pointer focus:outline-none shrink-0 transition-colors p-0.5"
        title={`Sort by ${field}`}
      >
        {isSorted ? (
          sortDirection === "asc" ? (
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-300 font-bold leading-none">▲</span>
          ) : (
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-300 font-bold leading-none">▼</span>
          )
        ) : (
          <span className="text-[8px] text-muted-foreground leading-none">▼</span>
        )}
      </button>
    );
  };

  // Mouse drag handler for column resizing.
  // The drag paints straight to the DOM and dispatches once on mouseup — dispatching per
  // mousemove re-rendered the whole table at pointer-event rate. `columnWidths` only ever
  // drives these two style properties, so writing them directly stays behaviour-neutral.
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTHS[columnIndex] ?? 120;
    let latestWidth = startWidth;

    const table = tableRef.current;
    // <col> 0 is the select column, so data column N is <col> N + 1
    const col = table?.querySelectorAll("colgroup > col")[columnIndex + 1] as HTMLElement | undefined;
    const startTotalWidth = table ? parseFloat(table.style.width) || 0 : 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      latestWidth = Math.max(60, startWidth + deltaX);
      if (col) col.style.width = `${latestWidth}px`;
      if (table) table.style.width = `${startTotalWidth + (latestWidth - startWidth)}px`;
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (latestWidth !== startWidth) {
        dispatch(setColumnWidth({ index: columnIndex, width: latestWidth }));
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };



  // Inline table cell dropdown update handlers
  const handleEnquiryFieldChange = async (enquiryId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateEnquiryField enquiry=${enquiryId} field=${field} val="${dbVal}"`);
    const toastId = toast.loading(`Saving ${field}...`);
    try {
      await dispatch(updateEnquiryField({ enquiryId, field, value: dbVal })).unwrap();
      toast.success(`Saved successfully.`, { id: toastId });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  const [deletingEnquiryId, setDeletingEnquiryId] = useState<string | null>(null);
  const handleDeleteDuplicate = async (enquiry: EnquiryData) => {
    if (!enquiry.duplicateOfDocket) return;
    if (
      !confirm(
        `Delete blank docket ${enquiry.docketNumber} as a duplicate of ${enquiry.duplicateOfDocket}? Its source mail will be re-linked to ${enquiry.duplicateOfDocket}.`,
      )
    )
      return;
    setDeletingEnquiryId(enquiry.id);
    const toastId = toast.loading(`Deleting ${enquiry.docketNumber}...`);
    try {
      await dispatch(deleteEnquiry(enquiry.id)).unwrap();
      toast.success(`Deleted ${enquiry.docketNumber}.`, { id: toastId });
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to delete docket",
        { id: toastId },
      );
    } finally {
      setDeletingEnquiryId(null);
    }
  };

  const handleSelectedContractNoChange = async (enquiryId: string, values: string[]) => {
    console.log(`[Client] updateEnquiryField enquiry=${enquiryId} field=selectedContractNo val="${values.join(",")}"`);
    const toastId = toast.loading(`Saving selected contracts...`);
    try {
      await dispatch(updateEnquiryField({ enquiryId, field: "selectedContractNo", value: values })).unwrap();
      toast.success(`Selected contracts saved.`, { id: toastId });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  const getItemNameMerge = (item: EnquiryItemData) => {
    const orderedFields = [
      item.itemType,
      item.moc,
      item.size,
      item.pnRating,
      item.operationType,
      item.extension,
      item.bypass
    ];
    const base = orderedFields
      .map(val => (val || "").trim())
      .filter(Boolean)
      .join("-");

    const others = Array.isArray(item.others) ? item.others : [];
    const othersStr = others
      .map(v => String(v).trim())
      .filter(Boolean)
      .join("-");

    if (!othersStr) return base;
    return base ? `${base}-WITH-${othersStr}` : `WITH-${othersStr}`;
  };

  const handleItemFieldChange = async (itemId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateItemField item=${itemId} field=${field} val="${dbVal}"`);
    // Client-side frozen guard: pricing columns (incl. quantity) are frozen after one-time PDF
    if (FROZEN_ITEM_FIELD_SET.has(field)) {
      const parentItem = allItems.find((i) => i.id === itemId) || null;
      const parentEnquiry = parentItem ? enquiries.find((e) => e.id === parentItem.enquiryId) : null;
      if (parentEnquiry && isEnquiryFrozen((parentEnquiry as any).apm, (parentEnquiry as any).offerPdfGeneratedAt)) {
        toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit.");
        return;
      }
    }
    const toastId = toast.loading(`Saving ${field}...`);
    const prevItem = allItems.find((i) => i.id === itemId) || null;
    const prevQr = prevItem?.quotedRate ? parseFloat(String(prevItem.quotedRate)) : null;

    try {
      const result = await dispatch(updateItemField({ itemId, field, value: dbVal })).unwrap();
      toast.success(`Saved successfully.`, { id: toastId });

      // Toast when QR is rounded up after manual entry
      const newQr = result?.quotedRate ? parseFloat(String(result.quotedRate)) : null;
      if (newQr !== null && !isNaN(newQr)) {
        if (field === "quotedRate" && dbVal !== null) {
          const inNum = parseFloat(String(dbVal).replace(/,/g, ""));
          if (!isNaN(inNum) && inNum !== newQr) {
            toast.info(`Quoted Rate rounded up: ${inNum.toFixed(2)} → ${newQr.toFixed(2)}`, { duration: 4000 });
          }
        } else if (["vaPercent", "cost", "productCost", "extension", "bypass", "quantity"].includes(field)) {
          // For vaPercent/cost etc., QR is derived — toast when the QR value changes
          if (prevQr !== null && prevQr !== newQr) {
            toast.info(`Quoted Rate rounded up: ${newQr.toFixed(2)}`, { duration: 4000 });
          } else if (prevQr === null && newQr !== null) {
            toast.info(`Quoted Rate rounded up: ${newQr.toFixed(2)}`, { duration: 3000 });
          }
        }
      }

      // When updating item name, warn if size wasn't detected
      if (field === "itemName" && result && !result.size) {
        toast.info("Size not mentioned in item name — please add manually.", { id: undefined, duration: 5000 });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  // Paste a column of Cost / VA% / Quoted Rate values into a docket's items in order.
  const handleBulkFieldPaste = async (
    enquiry: EnquiryData,
    field: "cost" | "vaPercent" | "quotedRate",
    e: React.ClipboardEvent<HTMLInputElement>,
    startIndex: number
  ) => {
    // Frozen guard: bulk paste mutates frozen pricing columns
    if (isEnquiryFrozen((enquiry as any).apm, (enquiry as any).offerPdfGeneratedAt)) {
      toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit.");
      e.preventDefault();
      return;
    }
    const clipboardData = e.clipboardData.getData("text");
    if (!clipboardData) return;

    const lines = clipboardData.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return; // Single value → allow the normal paste
    }

    e.preventDefault();

    const targets = getFilteredItems(enquiry).slice(startIndex);
    if (targets.length === 0) return;

    const updates: { item: { id: string }; cost?: number; vaPercent?: number; quotedRate?: number }[] = [];
    let invalid = false;

    lines.forEach((line, idx) => {
      const target = targets[idx];
      if (!target) return;
      const entry: { item: { id: string }; cost?: number; vaPercent?: number; quotedRate?: number } = { item: target };

      if (field === "cost") {
        const parts = line.split("\t").map((p) => p.trim());
        const costRaw = parts[0] || "";
        const vaRaw = parts.length > 1 ? parts[1] : "";
        if (costRaw) {
          const c = parseFloat(costRaw.replace(/,/g, ""));
          if (isNaN(c)) {
            invalid = true;
            return;
          }
          entry.cost = c;
        }
        if (vaRaw) {
          const v = parseFloat(vaRaw.replace(/%/g, ""));
          if (isNaN(v)) {
            invalid = true;
            return;
          }
          entry.vaPercent = v;
        }
      } else {
        const v = parseFloat(line.replace(/%/g, "").replace(/,/g, ""));
        if (isNaN(v)) {
          invalid = true;
          return;
        }
        if (field === "quotedRate") {
          entry.quotedRate = v;
        } else {
          entry.vaPercent = v;
        }
      }

      updates.push(entry);
    });

    if (invalid) {
      toast.error("Pasted values must be valid numbers.");
      return;
    }
    if (updates.length === 0) return;

    const toastId = toast.loading(`Updating ${updates.length} item(s)...`);
    try {
      const allResults = await Promise.all(
        updates.map(async ({ item, cost, vaPercent, quotedRate }) => {
          const resItems: any[] = [];
          if (cost !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "cost", value: cost.toString() })).unwrap();
            resItems.push(r);
          }
          if (vaPercent !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "vaPercent", value: vaPercent.toString() })).unwrap();
            resItems.push(r);
          }
          if (quotedRate !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "quotedRate", value: quotedRate.toString() })).unwrap();
            resItems.push(r);
          }
          return resItems;
        })
      );
      const flatResults = (allResults.flat() as any[]) as EnquiryItemData[];
      // Deduplicate to last result per item id (for cost+va case, last holds final QR)
      const lastById = new Map<string, EnquiryItemData>();
      for (const r of flatResults) lastById.set(r.id, r);
      toast.success(`Updated ${updates.length} item(s).`, { id: toastId });
      // One aggregated toast for rounding
      if (field === "quotedRate") {
        let roundedCount = 0;
        updates.forEach(({ item, quotedRate }) => {
          if (quotedRate !== undefined) {
            const res = lastById.get(item.id);
            const outQr = res?.quotedRate ? parseFloat(String(res.quotedRate)) : null;
            if (outQr !== null && !isNaN(outQr) && outQr !== quotedRate) roundedCount++;
          }
        });
        if (roundedCount > 0) {
          toast.info(`${roundedCount} rate(s) rounded up`, { duration: 4000 });
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update items.", { id: toastId });
    }
  };

  // Filter logic matching dropdown selections exactly
  // This manual memo is intentionally kept for a large predicate; React Compiler cannot
  // preserve it (and compiler is not enabled), so the diagnostic is suppressed locally.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const filteredEnquiries = useMemo(() => enquiries.filter((enquiry) => {
    // 0. Global search — same predicate the dashboard's Prisma `where` clause used to run
    if (!matchesGlobalSearch(enquiry, globalSearch)) return false;

    // 1. Enquiry Date range
    if (filters.enquiryDateFrom) {
      const fromDate = new Date(filters.enquiryDateFrom);
      if (new Date(enquiry.enquiryDate) < fromDate) return false;
    }
    if (filters.enquiryDateTo) {
      const toDate = new Date(filters.enquiryDateTo);
      const toDateLimit = new Date(toDate);
      toDateLimit.setDate(toDateLimit.getDate() + 1);
      if (new Date(enquiry.enquiryDate) > toDateLimit) return false;
    }

    // 2. Docket Number (Text Search)
    if (
      filters.docketNumber &&
      !enquiry.docketNumber
        .toLowerCase()
        .includes(filters.docketNumber.toLowerCase())
    ) {
      return false;
    }

    // 3. Party Name (Multi-select Checklist Search)
    if (
      filters.partyNames.length > 0 &&
      !filters.partyNames.includes(enquiry.partyName)
    ) {
      return false;
    }

    // 4-10. Enquiry-level Metadata Dropdown Filters
    if (!matchesMulti(filters.enquiryType, enquiry.enquiryType)) {
      return false;
    }
    if (!matchesMulti(filters.state, enquiry.state)) {
      return false;
    }
    if (!matchesMulti(filters.paymentTerms, enquiry.paymentTerms)) {
      return false;
    }
    if (!matchesMulti(filters.inspection, enquiry.inspection)) {
      return false;
    }
    if (!matchesMulti(filters.pbg, enquiry.pbg)) {
      return false;
    }
    if (!matchesMulti(filters.utility, enquiry.utility)) {
      return false;
    }
    if (!matchesMulti(filters.orderStatus, enquiry.orderStatus)) {
      return false;
    }
    if (!matchesMultiCI(filters.closureStatus, enquiry.closureStatus)) {
      return false;
    }
    if (!matchesMulti(filters.apm, (enquiry as any).apm)) {
      return false;
    }
    if (!contractNoMatches(filters.contractNo as unknown as string[], enquiry)) {
      return false;
    }

    // 11. Project Reference (Text Search)
    if (
      filterProjectReference &&
      !(enquiry.projectReference || "").toLowerCase().includes(filterProjectReference.toLowerCase())
    ) {
      return false;
    }

    // Email Address (Text Search) — matches the sender only
    if (
      filters.emailAddress &&
      !(enquiry.senderEmail || "").toLowerCase().includes(filters.emailAddress.toLowerCase())
    ) {
      return false;
    }

    // Contact No (Text Search)
    if (
      filters.contactNo &&
      !(enquiry.contactNo || "").toLowerCase().includes(filters.contactNo.toLowerCase())
    ) {
      return false;
    }

    // 11-24. Item details (mix of text search and exact dropdown selections)
    const matchesItems = enquiry.items.some((item) => {
      if (
        filters.itemName &&
        !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quantity &&
        !item.quantity.toString().includes(filters.quantity)
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemType, item.itemType)) {
        return false;
      }
      if (
        filters.itemTypeSearch &&
        !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.moc, item.moc)) {
        return false;
      }
      if (
        filters.mocSearch &&
        !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.size, item.size, isBlankSize)) {
        return false;
      }
      if (!matchesMulti(filters.pnRating, item.pnRating)) {
        return false;
      }
      if (!matchesMulti(filters.operationType, item.operationType)) {
        return false;
      }
      if (!matchesMulti(filters.extension, item.extension)) {
        return false;
      }
      if (!matchesMulti(filters.bypass, item.bypass)) {
        return false;
      }
      if (!matchesMulti((filters as any).others, (item as any).others, isBlankOthers)) {
        return false;
      }
      if (
        (filters as any).othersSearch &&
        !((item as any).others || "").toLowerCase().includes((filters as any).othersSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) {
        return false;
      }
      if (
        filters.erpItemCodeSearch &&
        !(item.erpItemCode || "").toLowerCase().includes(filters.erpItemCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.bomId as any, (item as any).bomId)) {
        return false;
      }
      if (
        filters.bomIdSearch &&
        !((item as any).bomId || "").toLowerCase().includes(filters.bomIdSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) {
        return false;
      }
      if (
        filters.contractReviewRateSearch &&
        !(item.contractReviewRate || "").toLowerCase().includes(filters.contractReviewRateSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.pdcostValidation, getPdCostValidation(item))) {
        return false;
      }
      if (
        filters.pdcostValidationSearch &&
        !(getPdCostValidation(item) || "").toLowerCase().includes(filters.pdcostValidationSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.productCost.length > 0 &&
        !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)
      ) {
        return false;
      }
      if (!matchesMulti(filters.costRefCode, item.costRefCode)) {
        return false;
      }
      if (
        filters.costRefCodeSearch &&
        !(item.costRefCode || "").toLowerCase().includes(filters.costRefCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.cost.length > 0 &&
        !matchesMulti(filters.cost, item.cost != null ? String(item.cost) : null)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !(item.stockStatus || "").toLowerCase().includes(filters.stockStatus.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.stockQuantity &&
        !(item.stockQuantity || "").toLowerCase().includes(filters.stockQuantity.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.availableStock.length > 0 &&
        !matchesMulti(filters.availableStock, item.availableStock ?? null)
      ) {
        return false;
      }
      if (
        filters.rmType.length > 0 &&
        !matchesMulti(filters.rmType, item.rmType ?? null)
      ) {
        return false;
      }
      if (
        filters.deliverySchedule.length > 0 &&
        !matchesMulti(filters.deliverySchedule, item.deliverySchedule ?? null)
      ) {
        return false;
      }
      if (
        filters.stockAgainstContract &&
        !(item.stockAgainstContract || "").toLowerCase().includes(filters.stockAgainstContract.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.discount &&
        !(item.discount?.toString() || "").includes(filters.discount)
      ) {
        return false;
      }
      if (
        filters.vaPercent.length > 0 &&
        !matchesMulti(filters.vaPercent, item.vaPercent?.toString() ?? null)
      ) {
        return false;
      }
      if (
        filters.quotedRate &&
        !(item.quotedRate || "").toLowerCase().includes(filters.quotedRate.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quotedRateGst &&
        !(item.quotedRateGst || "").toLowerCase().includes(filters.quotedRateGst.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemNameMerge, item.itemNameMerge)) {
        return false;
      }
      if (
        filters.itemNameMergeSearch &&
        !(item.itemNameMerge || "").toLowerCase().includes(filters.itemNameMergeSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.totalValue &&
        !(item.totalValue || "").toLowerCase().includes(filters.totalValue.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.itemWiseTotalValue &&
        !(item.itemWiseTotalValue || "").toLowerCase().includes(filters.itemWiseTotalValue.toLowerCase())
      ) {
        return false;
      }
      if (filters.validation.length > 0) {
        if (!matchesMulti(filters.validation, item.validation)) {
          return false;
        }
      }
      if ((filters as any).image && (filters as any).image.length > 0) {
        const hasImg = !!getItemImage(item);
        const wantPresent = (filters as any).image.includes("Present");
        const wantBlank = (filters as any).image.includes(BLANK);
        if (wantPresent && !wantBlank && !hasImg) return false;
        if (wantBlank && !wantPresent && hasImg) return false;
      }
      if (!itemDeletedStatus(item, filters.deletedStatus)) return false;
      return true;
    });

    // Header-only "pending" dockets (no items) have nothing to match item
    // filters against. Keep them visible in the default view, but hide them once
    // a filter is narrowing the list. When the "Pending only" filter is on, empty
    // dockets always pass and dockets with items are excluded below.
    if (!enquiry.items || enquiry.items.length === 0) {
      if (hasActiveFilters && !pendingOnly) return false;
    } else if (!matchesItems) {
      return false;
    }
    if (pendingOnly && (enquiry.items?.length ?? 0) > 0) return false;

    // 25. Attachment
    if (filters.attachment) {
      if (!enquiry.attachments || enquiry.attachments.length === 0) return false;
      const match = enquiry.attachments.some((att) =>
        att.name.toLowerCase().includes(filters.attachment.toLowerCase())
      );
      if (!match) return false;
    }

    return true;
  }), [enquiries, filters, filterProjectReference, globalSearch, getItemImage, hasActiveFilters, pendingOnly]);

  const getSortValue = useCallback((enquiry: EnquiryData, field: string): string | number | Date | null | undefined => {
    if (field === "contractNo") {
      return ((enquiry as any).selectedContractNo || []).join(", ");
    }
    const enquiryFields = [
      "enquiryDate", "docketNumber", "partyName", "enquiryType", "state", 
      "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "apm", "closureStatus", "projectReference"
    ];
    
    if (enquiryFields.includes(field)) {
      return (enquiry as unknown as Record<string, unknown>)[field] as string | number | Date | null | undefined;
    }
    
    if (field === "attachment") {
      return enquiry.attachments ? enquiry.attachments.length : 0;
    }

    if (field === "image") {
      const items = getFilteredItems(enquiry);
      if (items.length === 0) return 0;
      const imageCount = items.filter((it) => !!getItemImage(it)).length;
      return imageCount / items.length;
    }
    
    const firstItem = enquiry.items && enquiry.items[0];
    if (!firstItem) return null;
    
    if (field === "pdcostValidation") {
      const val = getPdCostValidation(firstItem);
      return val ? parseFloat(val.replace("%", "")) : null;
    }

    return (firstItem as unknown as Record<string, unknown>)[field] as string | number | Date | null | undefined;
  }, [getItemImage, getFilteredItems]);

  const sortedEnquiries = useMemo(() => [...filteredEnquiries].sort((a, b) => {
    if (!sortField) return 0;
    
    const valA = getSortValue(a, sortField);
    const valB = getSortValue(b, sortField);
    
    if (valA === null || valA === undefined || valA === "") return 1;
    if (valB === null || valB === undefined || valB === "") return -1;
    
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDirection === "asc" ? valA - valB : valB - valA;
    }
    
    if (valA instanceof Date && valB instanceof Date) {
      return sortDirection === "asc" 
        ? valA.getTime() - valB.getTime() 
        : valB.getTime() - valA.getTime();
    }
    
    if (sortField === "enquiryDate") {
      const timeA = new Date(valA).getTime();
      const timeB = new Date(valB).getTime();
      return sortDirection === "asc" ? timeA - timeB : timeB - timeA;
    }
    
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();

    const numA = parseFloat(strA);
    const numB = parseFloat(strB);
    if (/^-?\d+(\.\d+)?$/.test(strA) && /^-?\d+(\.\d+)?$/.test(strB)) {
      return sortDirection === "asc" ? numA - numB : numB - numA;
    }

    return sortDirection === "asc"
      ? strA.localeCompare(strB, undefined, { numeric: true })
      : strB.localeCompare(strA, undefined, { numeric: true });
  }), [filteredEnquiries, sortField, sortDirection, getSortValue]);

  const paginatedEnquiries = useMemo(
    () => sortedEnquiries.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedEnquiries, currentPage, pageSize]
  );


  const handleImportFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading("Reading Excel file...");
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) {
          toast.error("Failed to read file data.", { id: toastId });
          return;
        }

        const XLSX = await import("xlsx");
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

        if (rows.length === 0) {
          toast.error("No data rows found in the sheet.", { id: toastId });
          return;
        }

        const mappedRows = rows.map((row) => {
          let docketNumber = "";
          let itemName = "";
          let cost: number | null = null;
          let quotedRate: number | null = null;

          for (const key of Object.keys(row)) {
            const lowerKey = key.toLowerCase();
            const val = row[key];

            if (lowerKey.includes("docket") || lowerKey === "offer no" || lowerKey === "offerno") {
              docketNumber = String(val).trim();
            } else if (lowerKey.includes("item name") || lowerKey === "itemname") {
              itemName = String(val).trim();
            } else if (lowerKey === "cost" || lowerKey.includes("product cost")) {
              cost = val !== undefined && val !== null && val !== "" ? parseFloat(String(val)) : null;
            } else if (
              lowerKey.includes("quotation rate") ||
              lowerKey.includes("quoted rate") ||
              lowerKey === "rate" ||
              lowerKey === "rate/unit"
            ) {
              quotedRate = val !== undefined && val !== null && val !== "" ? parseFloat(String(val)) : null;
            }
          }

          return { docketNumber, itemName, cost, quotedRate };
        }).filter(r => r.docketNumber && r.itemName);

        if (mappedRows.length === 0) {
          toast.error("Could not find matching docket number and item name columns in the Excel sheet.", { id: toastId });
          return;
        }

        toast.loading(`Importing ${mappedRows.length} rows...`, { id: toastId });

        await dispatch(importExcelData(mappedRows)).unwrap();
        toast.success(`Imported successfully.`, { id: toastId });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "An error occurred during parsing.", { id: toastId });
      } finally {
        e.target.value = "";
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleExportToExcel = async () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows: Record<string, string | number>[] = [];

      sortedEnquiries.forEach((enquiry) => {
        if (!enquiry.items || enquiry.items.length === 0) {
          rows.push({
            "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
            "Docket No": enquiry.docketNumber,
            "Party Name": enquiry.partyName,
            "Enquiry Type": enquiry.enquiryType || "",
            "State": enquiry.state || "",
            "Payment Terms": enquiry.paymentTerms || "",
            "Inspection": enquiry.inspection || "",
            "PBG": enquiry.pbg || "",
            "Utility": enquiry.utility || "",
            "VA%": "",
            "Order Status": enquiry.orderStatus || "",
            "Closure Status": enquiry.closureStatus || "",
            "Project Reference": enquiry.projectReference || "",
            "Item Name": "",
            "Quantity": "",
            "Item Type": "",
            "MOC": "",
            "Size": "",
            "PN Rating": "",
            "Item Code": "",
            "BOM ID": "",
            "Operation Type": "",
            "Extension": "",
            "Bypass": "",
            "Other": "",
            "Product Cost": "",
            "Cost Ref Code": "",
"Cost": "",
              "Stock Status": "",
            "Stock Quantity": "",
            "Available Stock": "",
            "RM Type": "",
            "Stock Against Contract": "",
            "Discount": "",
            "Quotation Rate": "",
            "CR Rate": "",
            "PD Cost Validation": "",
            "Item Name Merge": "",
            "Total Value": "",
            "Itemwise Total Value": "",
              "Delivery Schedule": "",
              "Validation": "",
              "APM": (enquiry as any).apm || "",
              "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
              "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
           });
        } else {
          enquiry.items.forEach((item) => {
            rows.push({
              "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
              "Docket No": enquiry.docketNumber,
              "Party Name": enquiry.partyName,
              "Enquiry Type": enquiry.enquiryType || "",
              "State": enquiry.state || "",
              "Payment Terms": enquiry.paymentTerms || "",
              "Inspection": enquiry.inspection || "",
              "PBG": enquiry.pbg || "",
              "Utility": enquiry.utility || "",
              "VA%": item.vaPercent !== null ? `${item.vaPercent}%` : "",
              "Order Status": enquiry.orderStatus || "",
              "Closure Status": enquiry.closureStatus || "",
              "Project Reference": enquiry.projectReference || "",
              "Item Name": item.itemName,
              "Quantity": item.quantity ? Number(item.quantity) : "",
              "Item Type": item.itemType || "",
              "MOC": item.moc || "",
              "Size": item.size || "",
              "PN Rating": item.pnRating || "",
              "Item Code": (item as any).erpItemCode || item.erpItemCode || "",
              "BOM ID": (item as any).bomId || "",
              "Operation Type": item.operationType || "",
              "Extension": item.extension || "",
              "Bypass": item.bypass || "",
              "Other": Array.isArray((item as any).others) ? (item as any).others.join(", ") : (item as any).others || "",
              "Product Cost": item.productCost ? Number(item.productCost) : "",
              "Cost Ref Code": item.costRefCode || "",
              "Cost": item.cost ? Number(item.cost) : "",
              "Stock Status": item.stockStatus || "",
              "Stock Quantity": item.stockQuantity || "",
              "Available Stock": item.availableStock || "",
              "RM Type": item.rmType || "",
              "Stock Against Contract": item.stockAgainstContract || "",
              "Discount": item.discount ? `${Number(item.discount)}%` : "",
              "Quotation Rate": item.quotedRate || "",
              "CR Rate": item.contractReviewRate || "",
              "PD Cost Validation": getPdCostValidation(item) || "",
              "Item Name Merge": item.itemNameMerge || "",
              "Total Value": item.totalValue || "",
              "Itemwise Total Value": item.itemWiseTotalValue || "",
              "Delivery Schedule": item.deliverySchedule || "",
              "Validation": item.validation || "",
              "APM": (enquiry as any).apm || "",
              "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
              "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
            });
          });
        }
      });

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Enquiries");
      
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(workbook, `GMD_Quotation_Export_${dateStr}.xlsx`);
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: unknown) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const handleAutoFillBlanks = async () => {
    // Collect items that pass all active filters
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }

    const blankItems = matchedItems.filter(
      (i: EnquiryItemData) =>
        !i.itemType ||
        !i.moc ||
        !i.size ||
        i.size === "Not detectable" ||
        i.size === "Not mentioned/cant detect size" ||
        !i.operationType ||
        !i.extension ||
        i.extension === "-" ||
        !i.bypass ||
        i.bypass === "-"
    )
    // Items whose stored item type is wrong for the name (e.g. "Dual Plate Check
    // Valve" kept as CHECK VALVE) are corrected too, even with no blanks.
    const correctableItems = matchedItems.filter(
      (i: EnquiryItemData) => correctItemType(i.itemName, i.itemType) !== null
    )
    const itemsToProcess = [
      ...blankItems,
      ...correctableItems.filter((c) => !blankItems.some((b) => b.id === c.id)),
    ]
    console.log(`[Client] autoFillBlanks: ${itemsToProcess.length} items (${blankItems.length} with blanks, ${correctableItems.length} wrong item type) out of ${matchedItems.length} matched`);
    if (itemsToProcess.length === 0) {
      toast.info("No blank fields or item types to fix.")
      return
    }
    if (!confirm(`Auto-fill blanks / fix item types for ${itemsToProcess.length} items? This uses AI tokens for complex cases.`)) return

    setAutoFillStatus("running")
    await dispatch(autoFillBlanks(itemsToProcess.map((i: EnquiryItemData) => i.id))).unwrap()
    setAutoFillStatus("idle")
    toast.success(`Auto-fill complete.`)
  }

  const handleFetchItemCodes = async () => {
    // Collect every item that passes all active filters. Already-coded items are
    // included too: the button re-syncs the master sheet, so codes whose mapping
    // changed upstream are updated, not just blanks.
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }

    const missingCodeItems = matchedItems.filter((i) => !i.erpItemCode)
    const alreadyCoded = matchedItems.length - missingCodeItems.length
    console.log(`[Client] fetchItemCodes: ${matchedItems.length} item(s) in scope, ${missingCodeItems.length} currently missing a code`)
    if (matchedItems.length === 0) {
      toast.info("No items in the current view to refresh.")
      return
    }
    if (
      !confirm(
        `Re-check ERP item codes for ${matchedItems.length} item(s) against the live master sheet? ` +
          `${alreadyCoded} already coded (updated if the sheet mapping changed), ${missingCodeItems.length} missing.`
      )
    ) return

    setFetchCodesStatus("running")
    const toastId = toast.loading(`Refreshing ERP item codes for ${matchedItems.length} item(s)...`)
    try {
      const result = await dispatch(fetchItemCodes(matchedItems.map((i) => i.id))).unwrap()
      const changed: { itemName: string; from: string | null; to: string }[] = result?.changes ?? []
      const syncFailed = result?.syncFailed === true
      const changeLines = changed
        .slice(0, 8)
        .map((c) => `• ${(c.itemName || "").slice(0, 35)}: ${c.from ?? "(blank)"} → ${c.to}`)
        .join("\n")
      const extraChanges = changed.length > 8 ? `\n...and ${changed.length - 8} more` : ""
      const changeBlock = changeLines ? (
        <div className="mt-1 whitespace-pre-line">
          {changeLines}
          {extraChanges}
        </div>
      ) : null

      if (result?.failures && result.failures.length > 0) {
        toast.warning(
          <div className="text-xs">
            <div className="font-semibold">
              {syncFailed ? "Master sheet sync failed - used last snapshot. " : ""}
              {changed.length > 0
                ? `Updated ${changed.length} code(s), ${result.fetched} item(s) now have a code, ${result.failures.length} not derivable:`
                : `${result.fetched} item(s) verified, ${result.failures.length} not derivable:`}
            </div>
            {changeBlock}
            <div className="mt-1 space-y-1 text-[11px] leading-relaxed opacity-90 max-h-48 overflow-y-auto whitespace-pre-line">
              {result.failures.map((f: any, idx: number) => (
                <div key={idx}>
                  <span className="font-medium text-amber-700 dark:text-amber-300">• {f.itemName.slice(0, 35)}:</span>{" "}
                  <span>{f.reason}</span>
                </div>
              ))}
            </div>
          </div>,
          { id: toastId, duration: 12000 }
        )
      } else if (changed.length > 0) {
        toast.success(
          <div className="text-xs">
            <div className="font-semibold">
              {syncFailed ? "Master sheet sync failed - used last snapshot. " : ""}
              Updated {changed.length} item code(s), {result.fetched} verified.
            </div>
            {changeBlock}
          </div>,
          { id: toastId, duration: 9000 }
        )
      } else if (syncFailed) {
        toast.warning(`Master sheet sync failed - verified ${result?.fetched ?? 0} item(s) against the last snapshot.`, {
          id: toastId,
          duration: 8000,
        })
      } else {
        toast.success(`Item codes up to date - ${result?.fetched ?? 0} item(s) verified, no changes in the master sheet.`, {
          id: toastId,
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch item codes."
      toast.error(
        <div className="text-xs">
          <div className="font-semibold">Item codes not found</div>
          <div className="mt-1 text-[11px] leading-relaxed opacity-90 whitespace-pre-line">
            {message}
          </div>
        </div>,
        { id: toastId, duration: 14000 }
      )
    } finally {
      setFetchCodesStatus("idle")
    }
  }

  const handleUpdateAllBomCosts = async () => {
    const frozenEnquiryIds = new Set(
      paginatedEnquiries
        .filter((e) => isEnquiryFrozen((e as any).apm, (e as any).offerPdfGeneratedAt))
        .map((e) => e.id)
    );
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      if (frozenEnquiryIds.has(enquiry.id)) continue;
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }
    if (frozenEnquiryIds.size > 0) {
      toast(`Skipping frozen enquiries (${frozenEnquiryIds.size}) — rate & cost are frozen after one-time PDF.`, { duration: 3000 });
    }

    // Items that need a cost: either they have an item code (sheet/DIRECT M2M
    // path) or they have no BOM at all (Indent Listing cost-ref path, which is
    // keyed on item name/size/PN and does not need an item code).
    const targetItems = matchedItems.filter(
      (i) =>
        (i.erpItemCode || !i.bomId) &&
        (!i.productCost || !i.cost || Number(i.cost) === 0)
    )
    console.log(`[Client] updateAllBomCosts: ${targetItems.length} target items out of ${matchedItems.length} matched`)
    if (targetItems.length === 0) {
      const bomNoCodeCount = matchedItems.filter((i) => i.bomId && !i.erpItemCode).length
      if (bomNoCodeCount > 0) {
        toast.info(`Found ${bomNoCodeCount} item(s) with a BOM but no ERP item code. Please click 'Fetch Item Codes' first.`)
      } else {
        toast.info("No items requiring cost updates found.")
      }
      return
    }
    if (!confirm(`Update costs (BOM DIRECT M2M & 2:1, plus Indent Listing fallback) for ${targetItems.length} item(s)?`)) return

    setUpdateCostStatus("running")
    const toastId = toast.loading(`Updating BOM costs for ${targetItems.length} item(s)...`)
    try {
      const result = await dispatch(updateAllBomCosts(targetItems.map((i) => i.id))).unwrap()
      const indentPart = result.indentRefFilled
        ? `, ${result.indentRefFilled} cost ref(s) filled from Indent Listing`
        : ""
      toast.success(`Costs updated for ${result.updated} item(s)${indentPart}.`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to update BOM costs."
      toast.error(message, { id: toastId })
    } finally {
      setUpdateCostStatus("idle")
    }
  }

  const handleAutoFillVa = async () => {
    const frozenEnquiryIds2 = new Set(
      paginatedEnquiries
        .filter((e) => isEnquiryFrozen((e as any).apm, (e as any).offerPdfGeneratedAt))
        .map((e) => e.id)
    );
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      if (frozenEnquiryIds2.has(enquiry.id)) continue;
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }
    if (frozenEnquiryIds2.size > 0) {
      toast(`Skipping frozen enquiries (${frozenEnquiryIds2.size}) — VA% is frozen after one-time PDF.`, { duration: 3000 });
    }

    const blankVaItems = matchedItems.filter((i: EnquiryItemData) => !i.vaPercent)
    console.log(`[Client] autoFillVa: ${blankVaItems.length} items with blank VA% out of ${matchedItems.length} matched`)
    blankVaItems.forEach((i: EnquiryItemData) => console.log(`  → ${i.itemName} (type: ${i.itemType || "?"}, size: ${i.size || "?"})`))
    if (blankVaItems.length === 0) {
      toast.info("No blank VA% fields to fill.")
      return
    }
    if (!confirm(`Auto-fill VA% for ${blankVaItems.length} items (based on item type + size defaults)?`)) return

    setVaStatus("running")
    try {
      const result = await dispatch(updateVaPercent(blankVaItems.map((i: EnquiryItemData) => i.id))).unwrap()
      console.log(`[Client] VA% auto-fill result:`, result)
      toast.success(`VA% auto-fill complete.`)
    } catch (err) {
      console.error(`[Client] VA% auto-fill failed:`, err)
    } finally {
      setVaStatus("idle")
    }
  }

  const handleFetchContractReviewRates = async () => {
    // Collect items with an erpItemCode from currently paginated enquiries that pass active filters
    const itemsWithCode: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of getFilteredItems(enquiry)) {
        if (item.erpItemCode) itemsWithCode.push(item)
      }
    }
    if (itemsWithCode.length === 0) {
      toast.info("No items with ERP item codes found on this page.")
      return
    }
    if (
      !confirm(
        `Fetch Contract Review rates for ${itemsWithCode.length} item(s) with ERP item codes?\n\n` +
          `Any BLANK Cost Ref Code will also be filled from the Contract Review cost code ref. ` +
          `Items that already have a Cost Ref Code are left untouched, and a cost code ref ` +
          `that matches more than one RM code is skipped.`,
      )
    )
      return

    setCrRateStatus("running")
    const toastId = toast.loading(`Fetching Contract Review rates for ${itemsWithCode.length} item(s)...`)
    try {
      const result = await dispatch(fetchContractReviewRates(itemsWithCode.map((i) => i.id))).unwrap()
      const costRefParts: string[] = []
      if (result.costRefFilled) costRefParts.push(`${result.costRefFilled} cost code ref filled`)
      if (result.costRefMulti) costRefParts.push(`${result.costRefMulti} multi-code skipped`)
      if (result.costRefNoMatch) costRefParts.push(`${result.costRefNoMatch} no contract row`)
      const costRefDetail = costRefParts.length > 0 ? ` | ${costRefParts.join(", ")}` : ""
      toast.success(
        `Contract Review rates updated for ${result.updated} item(s)${costRefDetail}`,
        { id: toastId },
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch CR rates."
      toast.error(message, { id: toastId })
    } finally {
      setCrRateStatus("idle")
    }
  }

  const handlePopulatePdCostVal = async () => {
    // Collect items from currently paginated enquiries that pass active filters and have both CR Rate and Product Cost
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of getFilteredItems(enquiry)) {
        if (item.contractReviewRate && item.productCost != null) {
          matchedItems.push(item)
        }
      }
    }
    if (matchedItems.length === 0) {
      toast.info("No items with both Contract Review Rate and Product Cost found on this page.")
      return
    }
    if (!confirm(`Populate PD Cost Validation % for ${matchedItems.length} item(s)?`)) return

    setPdCostValStatus("running")
    const toastId = toast.loading(`Populating PD Cost Validation % for ${matchedItems.length} item(s)...`)
    try {
      const result = await dispatch(populatePdCostValidation(matchedItems.map((i) => i.id))).unwrap()
      toast.success(`PD Cost Validation % updated for ${result.updated} item(s).`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to populate PD Cost Validation."
      toast.error(message, { id: toastId })
    } finally {
      setPdCostValStatus("idle")
    }
  }

  const handleSyncAvailableStock = async () => {
    if (!confirm("Sync available stock and RM Type for ALL items with a raw material code from Raw Materials dashboard (GMDUpdateItem)? This will backfill availableStock and rmType wherever rmItemCode matches.")) return

    setSyncStockStatus("running")
    const toastId = toast.loading("Syncing available stock and RM Type for all items with an RM code...")
    try {
      const result: any = await dispatch(syncAvailableStock(undefined)).unwrap()
      const count = result.count ?? 0
      if (count === 0) {
        toast.info("No available stock or RM Type changes found.", { id: toastId })
      } else {
        toast.success(`Available stock and RM Type synced for ${count} item(s).`, { id: toastId })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to sync available stock."
      toast.error(message, { id: toastId })
    } finally {
      setSyncStockStatus("idle")
    }
  }

  const TOTAL_COLUMNS = 41;
  const SELECT_COL_WIDTH = 44;
  const getColWidth = (idx: number) => columnWidths[idx] ?? DEFAULT_COLUMN_WIDTHS[idx] ?? 120;
  const totalTableWidth =
    Array.from({ length: TOTAL_COLUMNS }, (_, idx) => getColWidth(idx)).reduce((a, b) => a + b, 0) +
    SELECT_COL_WIDTH;

  const inputClass =
    "mt-1.5 w-full h-7 rounded border border-input bg-background px-2 py-0.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 normal-case";

  // Active inline cell dropdown styles (Google Sheets-like transparent border, visible chevron, hover background)
  const cellSelectClass =
    "w-full bg-transparent border-none text-xs text-foreground outline-none cursor-pointer focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-muted/80 transition-colors normal-case font-medium";
  const cellItemSelectClass =
    "w-full bg-transparent border-none text-xs text-muted-foreground outline-none cursor-pointer focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-muted/80 transition-colors normal-case font-medium";

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0">
      {/* Table Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Showing {filteredEnquiries.length} of {enquiries.length} enquiries
        </span>
        
        <div className="flex items-center gap-2 shrink-0">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <svg className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
              </svg>
              Reset Filters
            </button>
          )}

          <MultiSelectFilter
            label="Validation"
            allLabel="Validation: All"
            options={["Yes", "No"]}
            cascadedOptions={cascadedOptions.validation}
            selected={filters.validation}
            onChange={(v) => dispatch(setFilter({ field: "validation", value: v }))}
            includeBlank
            className="h-8 w-40 rounded-md border border-border bg-background text-foreground"
            panelClassName="w-56"
          />

          <button
            type="button"
            onClick={handleExportToExcel}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-[#0f62fe] hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-[#0f62fe] dark:text-blue-300 stroke-2" />
            Export Excel
          </button>

          <div className="relative">
            <input
              type="file"
              id="excel-import-file"
              accept=".xlsx, .xls"
              onChange={handleImportFromExcel}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => document.getElementById("excel-import-file")?.click()}
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300 stroke-2" />
              Import Excel
            </button>
          </div>

          <button
            type="button"
            onClick={handleAutoFillBlanks}
            disabled={autoFillStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/25 dark:bg-purple-500/10 dark:text-purple-300 dark:hover:bg-purple-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-700 dark:text-purple-300 stroke-2" />
            {autoFillStatus === "running" ? "Filling..." : "Auto-Fill Blanks"}
          </button>

          <button
            type="button"
            onClick={handleFetchItemCodes}
            disabled={fetchCodesStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-700 dark:text-blue-300 stroke-2 ${fetchCodesStatus === "running" ? "animate-spin" : ""}`} />
            {fetchCodesStatus === "running" ? "Refreshing..." : "Fetch Item Codes"}
          </button>

          <button
            type="button"
            onClick={handleUpdateAllBomCosts}
            disabled={updateCostStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <DollarSign className={`h-3.5 w-3.5 text-teal-700 dark:text-teal-300 stroke-2 ${updateCostStatus === "running" ? "animate-spin" : ""}`} />
            {updateCostStatus === "running" ? "Updating..." : "Update BOM Costs"}
          </button>

          <button
            type="button"
            onClick={handleFetchContractReviewRates}
            disabled={crRateStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-violet-700 dark:text-violet-300 stroke-2 ${crRateStatus === "running" ? "animate-spin" : ""}`} />
            {crRateStatus === "running" ? "Fetching..." : "Fetch CR Rates"}
          </button>

          <button
            type="button"
            onClick={handleSyncAvailableStock}
            disabled={syncStockStatus === "running" || updateCostStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
            title="Backfill availableStock and RM Type for all items with an RM code from Raw Materials (GMDUpdateItem)"
          >
            <PackageCheck className={`h-3.5 w-3.5 text-amber-700 dark:text-amber-300 stroke-2 ${syncStockStatus === "running" ? "animate-spin" : ""}`} />
            {syncStockStatus === "running" ? "Syncing Stock..." : "Sync Available Stock"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full min-w-0 border-b border-border">
        <table
        ref={tableRef}
        className="border-collapse text-left border border-border"
        style={{ tableLayout: "fixed", width: totalTableWidth }}
      >
        <colgroup>
          <col style={{ width: SELECT_COL_WIDTH }} />
          {Array.from({ length: TOTAL_COLUMNS }, (_, idx) => (
            <col key={idx} style={{ width: getColWidth(idx) }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-muted/80 select-none">
            {/* Select checkbox column */}
            <th className="py-2.5 px-2 sticky top-0 z-30 bg-muted/90 border-r border-b border-border text-center">
              {validSelectedItemIds.size > 0 && validSelectedEnquiryId ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  title="Clear selection"
                  className="inline-flex items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">Sel</span>
              )}
            </th>
            {/* 0. Enquiry Date */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Enquiry Date</span>
                {renderSortArrow("enquiryDate")}
              </div>
              <div className="flex gap-1 items-center mt-1.5">
                <FilterTextInput
                  field="enquiryDateFrom"
                  type="date"
                  placeholder=""
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-background text-foreground outline-none font-normal"
                />
                <span className="text-[9px] text-muted-foreground font-normal">to</span>
                <FilterTextInput
                  field="enquiryDateTo"
                  type="date"
                  placeholder=""
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-background text-foreground outline-none font-normal"
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(0, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 1. Docket No */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Docket No</span>
                {renderSortArrow("docketNumber")}
              </div>
              <FilterTextInput
                field="docketNumber"
                placeholder="Search..."
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setPendingOnly((v) => !v)}
                className={`mt-1.5 w-full h-6 rounded border text-[9px] font-semibold transition-colors cursor-pointer ${
                  pendingOnly
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 dark:hover:bg-amber-500/20"
                }`}
                title="Show only pending dockets (auto-created, no items yet)"
              >
                {pendingOnly ? "Pending only ✓" : "Pending only"}
              </button>
              <div
                onMouseDown={(e) => handleMouseDown(1, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 2. Party Name */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Party Name</span>
                {renderSortArrow("partyName")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Party Name"
                  allLabel="All Parties"
                  options={dropdownOptions.partyNames}
                  cascadedOptions={cascadedOptions.partyNames}
                  selected={filters.partyNames}
                  onChange={(v) => dispatch(setFilter({ field: "partyNames", value: v }))}
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(2, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 3. Contract Review (matched from ContractReview by party name) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Contract Number</span>
                {renderSortArrow("contractNo")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Contract Number"
                  allLabel="All Contracts"
                  options={allSelectedContractOptions}
                  cascadedOptions={cascadedOptions.contractNo || []}
                  selected={(filters as any).contractNo || []}
                  onChange={(v) => dispatch(setFilter({ field: "contractNo" as any, value: v }))}
                  includeBlank
                  includeAvailable
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(3, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 4. Enquiry Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Enquiry Type</span>
                {renderSortArrow("enquiryType")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Enquiry Type"
                  allLabel="All Types"
                  options={dropdownOptions.enquiryTypes}
                  cascadedOptions={cascadedOptions.enquiryType}
                  selected={filters.enquiryType}
                  onChange={(v) => dispatch(setFilter({ field: "enquiryType", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(4, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* State/Utility */}
            <th className="relative py-2.5 px-2.5 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">State / Utility</span>
                  {activeStateUtilityFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                      {activeStateUtilityFilterCount}
                    </span>
                  )}
                </div>
                {activeStateUtilityFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearStateUtilityFilters}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground hover:text-red-500 dark:hover:text-red-200 cursor-pointer transition-colors normal-case"
                    title="Clear State / Utility filters"
                  >
                    <X className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {/* Side-by-side compact dropdown filters for State and Utility */}
              <div className="grid grid-cols-2 gap-1 mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="State"
                  allLabel="State"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "State" : `State (${sel.length})`)}
                  options={dropdownOptions.states}
                  cascadedOptions={cascadedOptions.state}
                  selected={filters.state}
                  onChange={(v) => dispatch(setFilter({ field: "state", value: v }))}
                  includeBlank
                  searchPlaceholder="Search state..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.state.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Utility"
                  allLabel="Utility"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Utility" : `Util (${sel.length})`)}
                  options={dropdownOptions.utilities}
                  cascadedOptions={cascadedOptions.utility}
                  selected={filters.utility}
                  onChange={(v) => dispatch(setFilter({ field: "utility", value: v }))}
                  includeBlank
                  searchPlaceholder="Search utility..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.utility.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />
              </div>

              <div
                onMouseDown={(e) => handleMouseDown(5, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 6. Payment Terms / PBG / Inspection */}
            <th className="relative py-2.5 px-2.5 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">Payment / PBG / Insp</span>
                  {activePaymentTermsFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                      {activePaymentTermsFilterCount}
                    </span>
                  )}
                </div>
                {activePaymentTermsFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearPaymentTermsFilters}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground hover:text-red-500 dark:hover:text-red-200 cursor-pointer transition-colors normal-case"
                    title="Clear Payment / PBG / Inspection filters"
                  >
                    <X className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {/* Side-by-side compact dropdown filters for Payment Terms, PBG, Inspection */}
              <div className="grid grid-cols-3 gap-1 mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Payment Terms"
                  allLabel="Payment"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Payment" : `Pay (${sel.length})`)}
                  options={dropdownOptions.paymentTerms}
                  cascadedOptions={cascadedOptions.paymentTerms}
                  selected={filters.paymentTerms}
                  onChange={(v) => dispatch(setFilter({ field: "paymentTerms", value: v }))}
                  includeBlank
                  searchPlaceholder="Search payment terms..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.paymentTerms.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="PBG"
                  allLabel="PBG"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "PBG" : `PBG (${sel.length})`)}
                  options={dropdownOptions.pbgs}
                  cascadedOptions={cascadedOptions.pbg}
                  selected={filters.pbg}
                  onChange={(v) => dispatch(setFilter({ field: "pbg", value: v }))}
                  includeBlank
                  searchPlaceholder="Search PBG..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.pbg.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="center"
                />

                <MultiSelectFilter
                  label="Inspection"
                  allLabel="Inspect"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Inspect" : `Insp (${sel.length})`)}
                  options={dropdownOptions.inspections}
                  cascadedOptions={cascadedOptions.inspection}
                  selected={filters.inspection}
                  onChange={(v) => dispatch(setFilter({ field: "inspection", value: v }))}
                  includeBlank
                  searchPlaceholder="Search inspection..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.inspection.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />
              </div>

              <div
                onMouseDown={(e) => handleMouseDown(6, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            

            

            



            {/* Email Address */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Email Address</span>
              </div>
              <FilterTextInput
                field="emailAddress"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(7, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* Contact No */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Contact No</span>
              </div>
              <FilterTextInput
                field="contactNo"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(8, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 10. Order Status Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Order Status</span>
                {renderSortArrow("orderStatus")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Order Status"
                  allLabel="All Statuses"
                  options={dropdownOptions.orderStatuses}
                  cascadedOptions={cascadedOptions.orderStatus}
                  selected={filters.orderStatus}
                  onChange={(v) => dispatch(setFilter({ field: "orderStatus", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(9, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* Closure Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Closure Status</span>
                {renderSortArrow("closureStatus")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Closure Status"
                  allLabel="All"
                  options={dropdownOptions.closureStatuses}
                  cascadedOptions={cascadedOptions.closureStatus}
                  selected={filters.closureStatus}
                  onChange={(v) => dispatch(setFilter({ field: "closureStatus", value: v }))}
                  includeBlank
                  searchPlaceholder="Search closure status..."
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(10, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 11. Project Reference */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Project Reference</span>
                {renderSortArrow("projectReference")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterProjectReference}
                onChange={(e) => setFilterProjectReference(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(11, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 12. Item Name As Per Party */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name</span>
                {renderSortArrow("itemName")}
              </div>
              <FilterTextInput
                field="itemName"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(12, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* Details */}
            <th className="relative py-2.5 px-2.5 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>Details</span>
                  {activeDetailsFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                      {activeDetailsFilterCount}
                    </span>
                  )}
                </div>
                {activeDetailsFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearDetailsFilters}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground hover:text-red-500 dark:hover:text-red-200 cursor-pointer transition-colors normal-case"
                    title="Clear all details filters"
                  >
                    <X className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {/* Side-by-side compact dropdown filters (4 per row grid structure) */}
              <div className="grid grid-cols-4 gap-1 mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Type"
                  allLabel="Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Type" : `Type (${sel.length})`)}
                  options={dropdownOptions.itemTypes}
                  cascadedOptions={cascadedOptions.itemType}
                  selected={filters.itemType}
                  onChange={(v) => dispatch(setFilter({ field: "itemType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search type..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.itemType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="MOC"
                  allLabel="MOC"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "MOC" : `MOC (${sel.length})`)}
                  options={dropdownOptions.mocs}
                  cascadedOptions={cascadedOptions.moc}
                  selected={filters.moc}
                  onChange={(v) => dispatch(setFilter({ field: "moc", value: v }))}
                  includeBlank
                  searchPlaceholder="Search MOC..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.moc.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Size"
                  allLabel="Size"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Size" : `Size (${sel.length})`)}
                  options={dropdownOptions.sizes}
                  cascadedOptions={cascadedOptions.size}
                  selected={filters.size}
                  onChange={(v) => dispatch(setFilter({ field: "size", value: v }))}
                  includeBlank
                  searchPlaceholder="Search size..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.size.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="center"
                />

                <MultiSelectFilter
                  label="PN Rating"
                  allLabel="PN"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "PN" : `PN (${sel.length})`)}
                  options={dropdownOptions.pnRatings}
                  cascadedOptions={cascadedOptions.pnRating}
                  selected={filters.pnRating}
                  onChange={(v) => dispatch(setFilter({ field: "pnRating", value: v }))}
                  includeBlank
                  searchPlaceholder="Search PN rating..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.pnRating.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />

                <MultiSelectFilter
                  label="Operation Type"
                  allLabel="Op Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Op Type" : `Op (${sel.length})`)}
                  options={dropdownOptions.operationTypes}
                  cascadedOptions={cascadedOptions.operationType}
                  selected={filters.operationType}
                  onChange={(v) => dispatch(setFilter({ field: "operationType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search operation..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.operationType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Extension"
                  allLabel="Ext"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Ext" : `Ext (${sel.length})`)}
                  options={dropdownOptions.extensions}
                  cascadedOptions={cascadedOptions.extension}
                  selected={filters.extension}
                  onChange={(v) => dispatch(setFilter({ field: "extension", value: v }))}
                  includeBlank
                  searchPlaceholder="Search extension..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.extension.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Bypass"
                  allLabel="Bypass"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Bypass" : `Byp (${sel.length})`)}
                  options={dropdownOptions.bypasses}
                  cascadedOptions={cascadedOptions.bypass}
                  selected={filters.bypass}
                  onChange={(v) => dispatch(setFilter({ field: "bypass", value: v }))}
                  includeBlank
                  searchPlaceholder="Search bypass..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.bypass.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="center"
                />

                <MultiSelectFilter
                  label="Other"
                  allLabel="Other"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Other" : `Other (${sel.length})`)}
                  options={dropdownOptions.others || ["flange", "gasket", "nut and bolt"]}
                  cascadedOptions={cascadedOptions.others || []}
                  selected={filters.others || []}
                  onChange={(v) => dispatch(setFilter({ field: "others", value: v }))}
                  includeBlank
                  searchPlaceholder="Search other..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    (filters.others || []).length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />

                <MultiSelectFilter
                  label="RM Type"
                  allLabel="RM Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "RM Type" : `RM (${sel.length})`)}
                  options={Array.from(new Set([...RM_TYPE_OPTIONS, ...(cascadedOptions.rmType ?? [])]))}
                  cascadedOptions={cascadedOptions.rmType ?? []}
                  selected={filters.rmType}
                  onChange={(v) => dispatch(setFilter({ field: "rmType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search RM type..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.rmType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />
              </div>

              <div
                onMouseDown={(e) => handleMouseDown(13, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 12. Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quantity</span>
                {renderSortArrow("quantity")}
              </div>
              <FilterTextInput
                field="quantity"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(14, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 17. Item Code (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Code</span>
                {renderSortArrow("erpItemCode")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Code"
                  allLabel="All Codes"
                  options={cascadedOptions.erpItemCode}
                  cascadedOptions={cascadedOptions.erpItemCode}
                  selected={filters.erpItemCode}
                  onChange={(v) => dispatch(setFilter({ field: "erpItemCode", value: v }))}
                  includeBlank
                  searchPlaceholder="Search item codes..."
                />
              </div>
              <FilterTextInput
                field="erpItemCodeSearch"
                placeholder="Search item code..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div className="relative mt-1 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Deleted"
                  allLabel="All Items"
                  options={DELETED_STATUS_OPTIONS}
                  cascadedOptions={DELETED_STATUS_OPTIONS}
                  selected={filters.deletedStatus}
                  onChange={(v) => dispatch(setFilter({ field: "deletedStatus", value: v }))}
                  searchPlaceholder="Search status..."
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(15, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 18a. BOM ID (beside Item Code) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>BOM ID</span>
                {renderSortArrow("bomId")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="BOM ID"
                  allLabel="All BOM IDs"
                  options={cascadedOptions.bomId || []}
                  cascadedOptions={cascadedOptions.bomId || []}
                  selected={filters.bomId as any || []}
                  onChange={(v) => dispatch(setFilter({ field: "bomId" as any, value: v }))}
                  includeBlank
                  searchPlaceholder="Search BOM IDs..."
                />
              </div>
              <FilterTextInput
                field="bomIdSearch"
                placeholder="Search BOM ID..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(16, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 22. Product Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Product Cost</span>
                {renderSortArrow("productCost")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Product Cost"
                  allLabel="All Costs"
                  options={cascadedOptions.productCost}
                  cascadedOptions={cascadedOptions.productCost}
                  selected={filters.productCost}
                  onChange={(v) => dispatch(setFilter({ field: "productCost", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(17, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 23. Cost Ref Code */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost Ref Code</span>
                {renderSortArrow("costRefCode")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Cost Ref Code"
                  allLabel="All Codes"
                  options={cascadedOptions.costRefCode || []}
                  cascadedOptions={cascadedOptions.costRefCode || []}
                  selected={filters.costRefCode}
                  onChange={(v) => dispatch(setFilter({ field: "costRefCode", value: v }))}
                  includeBlank
                  searchPlaceholder="Search cost ref codes..."
                />
              </div>
              <FilterTextInput
                field="costRefCodeSearch"
                placeholder="Search..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(18, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 23. Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost</span>
                {renderSortArrow("cost")}
              </div>
              <MultiSelectFilter
                label="Cost"
                allLabel="Cost: All"
                options={cascadedOptions.cost}
                cascadedOptions={cascadedOptions.cost}
                selected={filters.cost}
                onChange={(v) => dispatch(setFilter({ field: "cost", value: v }))}
                includeBlank
                className="mt-1 h-6 w-full rounded border border-input bg-background px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
                panelClassName="w-56 z-80"
              />
              <div
                onMouseDown={(e) => handleMouseDown(19, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 27. Stock Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Status</span>
                {renderSortArrow("stockStatus")}
              </div>
              <FilterTextInput
                field="stockStatus"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(20, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 28. Stock Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Quantity</span>
                {renderSortArrow("stockQuantity")}
              </div>
              <FilterTextInput
                field="stockQuantity"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(21, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 29. Available Stock */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Available Stock</span>
                {renderSortArrow("availableStock")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Available Stock"
                  allLabel="All Stock"
                  options={cascadedOptions.availableStock ?? []}
                  cascadedOptions={cascadedOptions.availableStock ?? []}
                  selected={filters.availableStock}
                  onChange={(v) => dispatch(setFilter({ field: "availableStock", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(22, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* View Image */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>View Image</span>
                {renderSortArrow("image")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Image"
                  allLabel="All"
                  options={["Present"]}
                  cascadedOptions={["Present"]}
                  selected={(filters as any).image ?? []}
                  onChange={(v) => dispatch(setFilter({ field: "image" as any, value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(23, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 30. Stock Against Contract */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Against Contract</span>
                {renderSortArrow("stockAgainstContract")}
              </div>
              <FilterTextInput
                field="stockAgainstContract"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(24, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 31. Discount */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Discount</span>
                {renderSortArrow("discount")}
              </div>
              <FilterTextInput
                field="discount"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(25, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 32. VA% (Moved here next to Quotation Rate) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>VA%</span>
                {renderSortArrow("vaPercent")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="VA%"
                  allLabel="All VA%"
                  options={cascadedOptions.vaPercent}
                  cascadedOptions={cascadedOptions.vaPercent}
                  selected={filters.vaPercent}
                  onChange={(v) => dispatch(setFilter({ field: "vaPercent", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(26, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 33. Quoted Rate */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quotation Rate</span>
                {renderSortArrow("quotedRate")}
              </div>
              <FilterTextInput
                field="quotedRate"
                placeholder="Search..."
                className={inputClass}
              />
              <div className="mt-1.5 normal-case">
                <button
                  type="button"
                  onClick={handleClearQr}
                  disabled={clearQrRunning}
                  className="w-full px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                  title="Clear Quoted Rate (and GST/Total) for all filtered items (all pages) — VA% kept"
                >
                  {clearQrRunning ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(27, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 34. CR Rate (Contract Review Rate — read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Rate(Contract Review)</span>
                {renderSortArrow("contractReviewRate")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="CR Rate"
                  allLabel="All CR Rates"
                  options={cascadedOptions.contractReviewRate || []}
                  cascadedOptions={cascadedOptions.contractReviewRate || []}
                  selected={filters.contractReviewRate || []}
                  onChange={(v) => dispatch(setFilter({ field: "contractReviewRate", value: v }))}
                  includeBlank
                  searchPlaceholder="Search CR rates..."
                />
              </div>
              <FilterTextInput
                field="contractReviewRateSearch"
                placeholder="Search CR rate..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(28, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 35. PD Cost Validation (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>PD Cost Val</span>
                {renderSortArrow("pdcostValidation")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="PD Cost Val"
                  allLabel="All PD Cost Val"
                  options={cascadedOptions.pdcostValidation || []}
                  cascadedOptions={cascadedOptions.pdcostValidation || []}
                  selected={filters.pdcostValidation || []}
                  onChange={(v) => dispatch(setFilter({ field: "pdcostValidation", value: v }))}
                  includeBlank
                  searchPlaceholder="Search PD cost val..."
                />
              </div>
              <FilterTextInput
                field="pdcostValidationSearch"
                placeholder="Search PD cost val..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(29, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 36. QR incl. GST */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>QR incl. GST</span>
                {renderSortArrow("quotedRateGst")}
              </div>
              <FilterTextInput
                field="quotedRateGst"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(30, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 37. Item Name (Merge) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name (Merge)</span>
                {renderSortArrow("itemNameMerge")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Name (Merge)"
                  allLabel="All Names"
                  options={cascadedOptions.itemNameMerge ?? []}
                  cascadedOptions={cascadedOptions.itemNameMerge ?? []}
                  selected={filters.itemNameMerge}
                  onChange={(v) => dispatch(setFilter({ field: "itemNameMerge", value: v }))}
                  includeBlank
                  searchPlaceholder="Search merged item names..."
                />
              </div>
              <FilterTextInput
                field="itemNameMergeSearch"
                placeholder="Search item name..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(31, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 38. Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Total Value incl. GST</span>
                {renderSortArrow("totalValue")}
              </div>
              <FilterTextInput
                field="totalValue"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(32, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 39. Itemwise Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Itemwise Total Value</span>
                {renderSortArrow("itemWiseTotalValue")}
              </div>
              <FilterTextInput
                field="itemWiseTotalValue"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(33, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 40. Validation */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Validation</span>
                {renderSortArrow("validation")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Validation"
                  allLabel="All"
                  options={["Yes", "No"]}
                  cascadedOptions={cascadedOptions.validation}
                  selected={filters.validation}
                  onChange={(v) => dispatch(setFilter({ field: "validation", value: v }))}
                  includeBlank
                />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 normal-case">
                <button
                  type="button"
                  onClick={() => handleBulkValidation("Yes")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                  title="Set all filtered items (all pages) to Yes"
                >
                  {bulkValidationRunning === "Yes" ? "..." : "All Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkValidation("No")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                  title="Set all filtered items (all pages) to No"
                >
                  {bulkValidationRunning === "No" ? "..." : "All No"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkValidation("")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                  title="Clear validation for all filtered items (all pages)"
                >
                  {bulkValidationRunning === "Clear" ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(34, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 41. Attachment */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Attachment</span>
                {renderSortArrow("attachment")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterAttachment}
                onChange={(e) => setFilterAttachment(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(35, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 43. Delivery Schedule */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Delivery Schedule</span>
                {renderSortArrow("deliverySchedule")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Delivery Schedule"
                  allLabel="All"
                  options={cascadedOptions.deliverySchedule ?? []}
                  cascadedOptions={cascadedOptions.deliverySchedule ?? []}
                  selected={filters.deliverySchedule}
                  onChange={(v) => dispatch(setFilter({ field: "deliverySchedule", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(36, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 44. APM - beside Offer PDF (enquiry-based) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>APM</span>
                {renderSortArrow("apm")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="APM"
                  allLabel="All"
                  options={["Yes", "No"]}
                  cascadedOptions={cascadedOptions.apm}
                  selected={filters.apm}
                  onChange={(v) => dispatch(setFilter({ field: "apm", value: v }))}
                  includeBlank
                />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 normal-case">
                <button
                  type="button"
                  onClick={() => handleBulkApm("Yes")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Set all filtered enquiries (all pages) to Yes" : "Admin only"}
                >
                  {bulkApmRunning === "Yes" ? "..." : "All Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkApm("No")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Set all filtered enquiries (all pages) to No" : "Admin only"}
                >
                  {bulkApmRunning === "No" ? "..." : "All No"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkApm("")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Clear APM for all filtered enquiries (all pages)" : "Admin only"}
                >
                  {bulkApmRunning === "Clear" ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(37, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 45. Offer PDF */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Offer PDF</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(38, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 46. Duplicate */}
            <th className="relative sticky top-0 z-30 bg-muted/90 py-2.5 px-3 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Duplicate</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(39, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 47. Actions */}
            <th className="relative sticky top-0 z-30 bg-muted/90 py-2.5 px-3 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-b border-border text-right">
              <div>Actions</div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(40, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="bg-background">
          {filteredEnquiries.length === 0 ? (
            <tr>
              <td colSpan={TOTAL_COLUMNS + 1} className="py-20 px-4 text-center border-b border-border">
                <div className="flex flex-col items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
                    <Search className="h-6 w-6 stroke-[1.5]" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    No enquiries found
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                    Get started by adding items or creating a new enquiry.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            paginatedEnquiries.map((enquiry) => {
              const { company, branch } = parseParty(enquiry.partyName);
              const initials = getInitials(enquiry.partyName);
              let displayItems = getFilteredItems(enquiry);
              if (displayItems.length > 1 && sortField === "image") {
                displayItems = [...displayItems].sort((a, b) => {
                  const aVal = getItemImage(a) ? 1 : 0;
                  const bVal = getItemImage(b) ? 1 : 0;
                  return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
                });
              }
              const hasMultiple = displayItems.length > 1;
              const isExpanded = expandedRows[enquiry.id] ?? hasActiveFilters;
              const firstItem = displayItems[0];
              const selectedCount = displayItems.filter((i) => validSelectedItemIds.has(i.id)).length;
              const isAllSelected = displayItems.length > 0 && selectedCount === displayItems.length;
              const isSomeSelected = selectedCount > 0 && selectedCount < displayItems.length;
              const isThisEnquiryActive = validSelectedEnquiryId === enquiry.id;
              const isFrozen = isEnquiryFrozen((enquiry as any).apm, (enquiry as any).offerPdfGeneratedAt);

              // Setup custom brand avatar styles
              let badgeBg = "bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/25";
              if (initials === "RE") {
                badgeBg = "bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/25";
              } else if (initials === "AD") {
                badgeBg = "bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/25";
              } else if (initials === "LT") {
                badgeBg = "bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25";
              } else if (initials === "JS") {
                badgeBg = "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25";
              }

               return (
                <React.Fragment key={enquiry.id}>
                  {/* Main Docket / First Item Row */}
                  <tr
                    className={`transition-colors ${firstItem && invalidVaItemIds.has(firstItem.id) ? "bg-red-100 dark:bg-red-500/15" : "hover:bg-muted/20"}`}>
                    {/* Select checkbox for first item */}
                    <td className="py-3.5 px-2 text-center border-r border-b border-border">
                      {firstItem ? (
                        <input
                          type="checkbox"
                          checked={isItemSelected(firstItem.id)}
                          onChange={() => toggleItemSelection(enquiry.id, firstItem.id)}
                          className="h-3.5 w-3.5 rounded border-border text-[#0f62fe] dark:text-blue-300 focus:ring-blue-500 cursor-pointer"
                          title={isItemSelected(firstItem.id) ? "Deselect item" : "Select item"}
                        />
                      ) : null}
                    </td>
                    {/* Enquiry Date */}
                    <td className="py-3.5 px-4 text-xs text-muted-foreground border-r border-b border-border last:border-r-0 truncate">
                      {new Date(enquiry.enquiryDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>

                    {/* Docket No with expand arrow if applicable */}
                    <td className="py-3.5 px-4 text-xs font-semibold text-[#0f62fe] dark:text-blue-300 border-r border-b border-border last:border-r-0">
                      <div className="flex items-center flex-wrap gap-1">
                        {hasMultiple && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(enquiry.id, isExpanded)}
                            className="mr-1 inline-flex items-center justify-center p-0.5 hover:bg-muted rounded text-muted-foreground cursor-pointer focus:outline-none shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <span className="hover:underline cursor-pointer truncate">
                          {enquiry.docketNumber}
                        </span>
                        {(!enquiry.items || enquiry.items.length === 0) && (
                          <span
                            className="ml-1 px-1.5 py-0.5 text-[9px] font-semibold bg-amber-50 text-amber-700 rounded-full border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 shrink-0"
                            title="Auto-created pending docket - add items to complete it"
                          >
                            Pending - no items
                          </span>
                        )}
                        {hasMultiple && !isExpanded && (
                          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium bg-blue-50 text-blue-600 rounded-full border border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/25 shrink-0">
                            +{displayItems.length - 1} more items
                          </span>
                        )}
                      </div>
                      {/* Per-enquiry bulk delete bar: filtered scope, persisted across pagination */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {displayItems.length > 1 && (
                          <label className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              ref={(el) => { if (el) el.indeterminate = isSomeSelected; }}
                              onChange={() => toggleSelectAllForEnquiry(enquiry, displayItems)}
                              className="h-3 w-3 rounded border-border cursor-pointer"
                              title={isAllSelected ? "Deselect all filtered items" : "Select all filtered items"}
                            />
                            {isAllSelected ? "All" : "Select all"}
                            <span className="text-[9px] text-muted-foreground/70">({displayItems.length} filtered)</span>
                          </label>
                        )}
                        {isThisEnquiryActive && selectedCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">{selectedCount} selected</span>
                            <button
                              type="button"
                              onClick={() => setBulkConfirmOpen(true)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-500/20 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete ({selectedCount})
                            </button>
                            <button
                              type="button"
                              onClick={clearSelection}
                              className="inline-flex items-center p-0.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                              title="Clear selection"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Party Name */}
                    <td className="py-2.5 px-4 border-r border-b border-border last:border-r-0 truncate">
                      {editingPartyEnquiryId === enquiry.id ? (
                        <select
                          value={enquiry.partyName}
                          onChange={(e) => {
                            handleEnquiryFieldChange(enquiry.id, "partyName", e.target.value);
                            setEditingPartyEnquiryId(null);
                          }}
                          onBlur={() => setEditingPartyEnquiryId(null)}
                          autoFocus
                          className="w-full h-8 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground outline-none focus:border-blue-500 normal-case cursor-pointer font-semibold"
                        >
                          {dropdownOptions.partyNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center justify-between w-full group truncate">
                          <div className="flex items-center gap-3 truncate">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${badgeBg}`}
                            >
                              {initials}
                            </div>
                            <div className="flex flex-col truncate">
                              <span className="text-xs font-bold text-foreground truncate">
                                {company}
                              </span>
                              {branch && (
                                <span className="text-[10px] text-muted-foreground font-medium truncate">
                                  {branch}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingPartyEnquiryId(enquiry.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-2"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* 3. Contract Review — available contracts multi-select (persists to selectedContractNo) + manual Add */}
                    <td className="py-1 px-1 border-r border-b border-border last:border-r-0 align-top">
                      {enquiry.contractNo && enquiry.contractNo.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <div className="flex-1 min-w-0">
                              <MultiSelectFilter
                                label="Contract"
                                allLabel="—"
                                options={enquiry.contractNo}
                                cascadedOptions={enquiry.contractNo}
                                selected={(enquiry as any).selectedContractNo ?? []}
                                onChange={(values) => handleSelectedContractNoChange(enquiry.id, values)}
                                searchPlaceholder="Search contracts..."
                                className={cn(
                                  "text-[10px]",
                                  (!((enquiry as any).selectedContractNo) || ((enquiry as any).selectedContractNo).length === 0) && "text-muted-foreground"
                                )}
                                renderButtonLabel={(sel) => sel.length === 0 ? "—" : sel.join(", ")}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setAddingContractFor(enquiry.id)}
                              title="Manually add contract number"
                              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold rounded border border-blue-200 dark:border-blue-500/25 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </button>
                          </div>
                          {addingContractFor === enquiry.id && (
                            <input
                              autoFocus
                              type="text"
                              placeholder="Add contract numbers (comma separated)"
                              onChange={(e) => {
                                e.target.value = e.target.value.toUpperCase();
                              }}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                if (raw) {
                                  const validation = parseAndValidateContractNumbers(raw);
                                  if (!validation.isValid) {
                                    toast.error(validation.error || "Invalid contract number");
                                    setAddingContractFor(null);
                                    return;
                                  }
                                  if (validation.contracts.length > 0) {
                                    const current = ((enquiry as any).selectedContractNo ?? []) as string[];
                                    const merged = [...current];
                                    for (const v of validation.contracts) if (!merged.includes(v)) merged.push(v);
                                    if (merged.length !== current.length) handleSelectedContractNoChange(enquiry.id, merged);
                                  }
                                }
                                setAddingContractFor(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setAddingContractFor(null);
                              }}
                              className="w-full uppercase bg-background border border-blue-200 dark:border-blue-500/25 text-[10px] text-foreground outline-none p-1.5 rounded focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground placeholder:normal-case"
                            />
                          )}
                        </div>
                      ) : (
                        <input
                          key={enquiry.id + "-selectedContractNo-" + ((enquiry as any).selectedContractNo ?? []).join(",")}
                          type="text"
                          defaultValue={((enquiry as any).selectedContractNo ?? []).join(", ")}
                          placeholder="Add contract numbers (comma separated)"
                          onChange={(e) => {
                            e.target.value = e.target.value.toUpperCase();
                          }}
                          onBlur={(e) => {
                            const raw = e.target.value;
                            const current = ((enquiry as any).selectedContractNo ?? []) as string[];
                            const validation = parseAndValidateContractNumbers(raw);
                            if (!validation.isValid) {
                              toast.error(validation.error || "Invalid contract number");
                              e.target.value = current.join(", ");
                              return;
                            }
                            const arr = validation.contracts;
                            const same = arr.length === current.length && arr.every((v, i) => v === current[i]);
                            if (!same) handleSelectedContractNoChange(enquiry.id, arr);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="w-full uppercase bg-transparent border-none text-[10px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium placeholder:text-muted-foreground placeholder:normal-case"
                        />
                      )}
                    </td>

                    {/* 4. Enquiry Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.enquiryType || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "enquiryType", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.enquiryTypes.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* State/Utility */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
                      <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 w-full">
                          state:
                          <select
                            value={enquiry.state || ""}
                            onChange={(e) => handleEnquiryFieldChange(enquiry.id, "state", e.target.value)}
                            className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium w-full"
                          >
                            <option value="">-</option>
                            {dropdownOptions.states.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 w-full">
                          utility:
                          <select
                            value={enquiry.utility || ""}
                            onChange={(e) => handleEnquiryFieldChange(enquiry.id, "utility", e.target.value)}
                            className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium w-full"
                          >
                            <option value="">-</option>
                            {dropdownOptions.utilities.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </td>

                    {/* Payment Terms / PBG / Inspection */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
                      <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 w-full">
                          payment_terms:
                          <select
                            value={enquiry.paymentTerms || ""}
                            onChange={(e) => handleEnquiryFieldChange(enquiry.id, "paymentTerms", e.target.value)}
                            className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium w-full"
                          >
                            <option value="">-</option>
                            {dropdownOptions.paymentTerms.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 w-full">
                          inspection:
                          <select
                            value={enquiry.inspection || ""}
                            onChange={(e) => handleEnquiryFieldChange(enquiry.id, "inspection", e.target.value)}
                            className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium w-full"
                          >
                            <option value="">-</option>
                            {dropdownOptions.inspections.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 w-full">
                          pbg:
                          <select
                            value={enquiry.pbg || ""}
                            onChange={(e) => handleEnquiryFieldChange(enquiry.id, "pbg", e.target.value)}
                            className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium w-full"
                          >
                            <option value="">-</option>
                            {dropdownOptions.pbgs.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </td>

                    {/* Email Address (sender) */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {enquiry.senderEmail && isInternalEmail(enquiry.senderEmail) && (
                        <span
                          className="inline-block mb-0.5 px-1.5 py-0.5 text-[9px] font-semibold bg-slate-100 text-slate-600 rounded-full border border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/25"
                          title="Internal (GMD / Laser) email address"
                        >
                          Internal
                        </span>
                      )}
                      <input
                        key={enquiry.id + "-senderEmail-" + (enquiry.senderEmail || "")}
                        type="text"
                        defaultValue={enquiry.senderEmail || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.senderEmail || "")) {
                            handleEnquiryFieldChange(enquiry.id, "senderEmail", e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                      />
                    </td>

                    {/* Contact No */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <input
                        key={enquiry.id + "-contactNo-" + (enquiry.contactNo || "")}
                        type="text"
                        defaultValue={enquiry.contactNo || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.contactNo || "")) {
                            handleEnquiryFieldChange(enquiry.id, "contactNo", e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                      />
                    </td>

                    {/* 10. Order Status Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.orderStatus || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "orderStatus", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.orderStatuses.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* Closure Status */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.closureStatus || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "closureStatus", e.target.value)}
                        className={cn(
                          cellSelectClass,
                          enquiry.closureStatus === "Sent" && autoSentSet.has(enquiry.docketNumber) &&
                            "text-blue-600 font-semibold bg-blue-50/60 dark:bg-blue-950/30",
                          enquiry.closureStatus === "Pending" && autoPendingSet.has(enquiry.docketNumber) &&
                            "text-amber-600 font-semibold bg-amber-50/60 dark:bg-amber-950/30"
                        )}
                        title={
                          enquiry.closureStatus === "Sent" && autoSentSet.has(enquiry.docketNumber)
                            ? "Auto-detected from thread attachments/OCR"
                            : enquiry.closureStatus === "Pending" && autoPendingSet.has(enquiry.docketNumber)
                              ? "No email found for this docket"
                              : undefined
                        }
                      >
                        <option value="">-</option>
                        {dropdownOptions.closureStatuses.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {enquiry.closureStatus && !dropdownOptions.closureStatuses.includes(enquiry.closureStatus) && (
                          <option value={enquiry.closureStatus}>{enquiry.closureStatus}</option>
                        )}
                      </select>
                    </td>

                    {/* Project Reference */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <input
                        key={enquiry.id + "-projectReference-" + (enquiry.projectReference || "")}
                        type="text"
                        defaultValue={enquiry.projectReference || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.projectReference || "")) {
                            handleEnquiryFieldChange(enquiry.id, "projectReference", e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-center"
                      />
                    </td>

                    {/* First Item Name */}
                    <td className="py-2 px-2 text-xs text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top">
                      {firstItem ? (
                        editingItemNameId === firstItem.id ? (
                          <input
                            type="text"
                            defaultValue={firstItem.itemName}
                            autoFocus
                            onBlur={(e) => {
                              if (e.target.value.trim() !== firstItem.itemName) {
                                handleItemFieldChange(firstItem.id, "itemName", e.target.value.trim());
                              }
                              setEditingItemNameId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                              } else if (e.key === "Escape") {
                                setEditingItemNameId(null);
                              }
                            }}
                            className="w-full bg-background border border-blue-500 text-xs text-foreground outline-none p-1 rounded font-medium"
                          />
                        ) : (
                          <div className="flex items-center justify-between w-full group truncate">
                            <div className="w-full pr-1 wrap-break-word whitespace-normal leading-normal">
                              {firstItem.itemName}
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingItemNameId(firstItem.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-1.5 align-middle"
                              title="Edit item name"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      ) : (
                        "No items"
                      )}
                    </td>

                    {/* Details */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
                      {firstItem ? (
                        <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            type:
                            <select
                              value={firstItem.itemType || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "itemType", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.itemTypes.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            moc:
                            <select
                              value={firstItem.moc || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "moc", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.mocs.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            size:
                            <select
                              value={firstItem.size || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "size", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.sizes.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            pn_rating:
                            <select
                              value={firstItem.pnRating || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "pnRating", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.pnRatings.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            operation_type:
                            <select
                              value={firstItem.operationType || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "operationType", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.operationTypes.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            extension:
                            <select
                              value={firstItem.extension || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "extension", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.extensions.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            bypass:
                            <select
                              value={firstItem.bypass || ""}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "bypass", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {dropdownOptions.bypasses.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            other:
                            <div className="min-w-28">
                              <OthersInlineMultiSelect
                                value={(firstItem as any).others || []}
                                options={(dropdownOptions as any).others || ["flange", "gasket", "nut and bolt"]}
                                onChange={(next) => {
                                  const prev = ((firstItem as any).others || []) as string[];
                                  if (JSON.stringify(prev.slice().sort()) !== JSON.stringify(next.slice().sort())) {
                                    handleItemFieldChange(firstItem.id, "others", JSON.stringify(next));
                                  }
                                }}
                              />
                            </div>
                          </div>
                          <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                            rm_type:
                            <select
                              value={firstItem.rmType || ""}
                              disabled={isFrozen}
                              onChange={(e) => handleItemFieldChange(firstItem.id, "rmType", e.target.value)}
                              className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                            >
                              <option value="">-</option>
                              {firstItem.rmType && !RM_TYPE_OPTIONS.includes(firstItem.rmType) && (
                                <option value={firstItem.rmType}>{firstItem.rmType}</option>
                              )}
                              {RM_TYPE_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : "-"}
                    </td>

                    {/* First Item Quantity */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-quantity-" + (firstItem.quantity || "")}
                          type="text"
                          defaultValue={firstItem.quantity ? Number(firstItem.quantity).toString() : ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.quantity ? Number(firstItem.quantity).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "quantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* 18. First Item Item Code (read-only) */}
                    <ItemCodeCell item={firstItem} />

                    {/* 18a. First Item BOM ID (dropdown when multiple, else read-only) */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        (() => {
                          const avail = (firstItem as any).availableBomIds as string[] | undefined;
                          const hasMulti = Array.isArray(avail) && avail.length > 1;
                          if (hasMulti) {
                            return (
                              <select
                                value={(firstItem as any).bomId || ""}
                                disabled={isFrozen}
                                title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : (avail || []).join(", ")}
                                onChange={(e) => {
                                  if (isFrozen) { toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit."); return; }
                                  const v = e.target.value || null;
                                  toast.promise(dispatch(selectBomId({ itemId: firstItem.id, bomId: v })).unwrap(), {
                                    loading: "Saving BOM...",
                                    success: "BOM saved.",
                                    error: (err) => (typeof err === "string" ? err : err?.message || "Failed to save BOM."),
                                  });
                                }}
                                className="w-full text-[10px] border border-border rounded px-1 py-1 bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <option value="">-- select --</option>
                                {avail!.map((b) => (
                                  <option key={b} value={b}>{b}</option>
                                ))}
                              </select>
                            );
                          }
                          return <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={(firstItem as any).bomId || ""}>{(firstItem as any).bomId || "-"}</span>;
                        })()
                      ) : "-"}
                    </td>

                    {/* First Item Product Cost */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-productCost-" + (firstItem.productCost !== null && firstItem.productCost !== undefined ? Number(firstItem.productCost).toString() : "")}
                          type="text"
                          defaultValue={formatIndianNumber(firstItem.productCost)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, firstItem.productCost)) {
                              handleItemFieldChange(firstItem.id, "productCost", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost Ref Code */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-costRefCode-" + (firstItem.costRefCode || "")}
                          type="text"
                          defaultValue={firstItem.costRefCode || ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.costRefCode || "")) {
                              handleItemFieldChange(firstItem.id, "costRefCode", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-cost-" + (firstItem.cost !== null && firstItem.cost !== undefined ? Number(firstItem.cost).toString() : "")}
                          type="text"
                          defaultValue={formatIndianNumber(firstItem.cost)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, firstItem.cost)) {
                              handleItemFieldChange(firstItem.id, "cost", next);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Stock Status */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-stockStatus-" + (firstItem.stockStatus || "")}
                          type="text"
                          defaultValue={firstItem.stockStatus || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.stockStatus || "")) {
                              handleItemFieldChange(firstItem.id, "stockStatus", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Stock Quantity */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-stockQuantity-" + (firstItem.stockQuantity || "")}
                          type="text"
                          defaultValue={firstItem.stockQuantity || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.stockQuantity || "")) {
                              handleItemFieldChange(firstItem.id, "stockQuantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Available Stock */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-availableStock-" + (firstItem.availableStock || "")}
                          type="text"
                          defaultValue={firstItem.availableStock || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.availableStock || "")) {
                              handleItemFieldChange(firstItem.id, "availableStock", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item View Image */}
                    <ItemImageCells item={firstItem ?? null} image={firstItem ? getItemImage(firstItem) : null} />

                    {/* First Item Stock Against Contract */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-stockAgainstContract-" + (firstItem.stockAgainstContract || "")}
                          type="text"
                          defaultValue={firstItem.stockAgainstContract || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.stockAgainstContract || "")) {
                              handleItemFieldChange(firstItem.id, "stockAgainstContract", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Discount */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-discount-" + (firstItem.discount !== null && firstItem.discount !== undefined ? Number(firstItem.discount).toString() : "")}
                          type="text"
                          defaultValue={firstItem.discount !== null && firstItem.discount !== undefined ? Number(firstItem.discount).toString() : ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.discount !== null && firstItem.discount !== undefined ? Number(firstItem.discount).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "discount", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item VA% */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 font-semibold ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-vaPercent-" + (firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : "")}
                          type="text"
                          defaultValue={firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : "")) {
                              handleItemFieldChange(firstItem.id, "vaPercent", val);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Quoted Rate */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-" + (firstItem.quotedRate || "")}
                          type="text"
                          defaultValue={formatIndianNumber(firstItem.quotedRate)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, firstItem.quotedRate)) {
                              handleItemFieldChange(firstItem.id, "quotedRate", next);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item CR Rate (Contract Review Rate — read-only) */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-xs text-violet-700 dark:text-violet-300 p-1 font-medium text-right">
                        {formatIndianNumber(firstItem?.contractReviewRate) || "-"}
                      </span>
                    </td>

                    {/* First Item PD Cost Validation (read-only) */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-xs text-blue-700 dark:text-blue-300 p-1 font-medium text-right">
                        {firstItem ? getPdCostValidation(firstItem) || "-" : "-"}
                      </span>
                    </td>

                    {/* First Item QR incl. GST */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <span className="block text-xs text-foreground p-1 font-medium text-right">
                          {formatIndianNumber(firstItem.quotedRateGst) || "-"}
                        </span>
                      ) : "-"}
                    </td>

                    {/* First Item Item Name Merge */}
                    <td className="py-3 px-3 border-r border-b border-border last:border-r-0 text-xs text-muted-foreground font-medium truncate">
                      {firstItem ? getItemNameMerge(firstItem) || "-" : "-"}
                    </td>

                    {/* First Item Total Value */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-totalValue-" + (firstItem.totalValue || "")}
                          type="text"
                          defaultValue={formatIndianNumber(firstItem.totalValue)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, firstItem.totalValue)) {
                              handleItemFieldChange(firstItem.id, "totalValue", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Itemwise Total Value */}
                    <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-itemWiseTotalValue-" + (firstItem.itemWiseTotalValue || "")}
                          type="text"
                          defaultValue={formatIndianNumber(firstItem.itemWiseTotalValue)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, firstItem.itemWiseTotalValue)) {
                              handleItemFieldChange(firstItem.id, "itemWiseTotalValue", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* Validation */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleItemFieldChange(firstItem.id, "validation", firstItem.validation === "Yes" ? "" : "Yes")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "Yes"
                                ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                                : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleItemFieldChange(firstItem.id, "validation", firstItem.validation === "No" ? "" : "No")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "No"
                                ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                                : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                            }`}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* Attachment - like Item Name, self scrollable */}
                    <td className="py-2 px-2 text-xs border-r border-b border-border last:border-r-0 align-top overflow-hidden">
                      <div className="flex flex-col gap-1 w-full min-w-0">
                        <div className="max-h-12 overflow-y-auto w-full pr-1 cell-scrollable wrap-break-word whitespace-normal leading-normal flex flex-col gap-1 min-w-0">
                          {enquiry.attachments && enquiry.attachments.length > 0 ? (
                            enquiry.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={att.url || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={att.name}
                                className="flex items-start gap-1.5 text-xs font-semibold text-[#0f62fe] dark:text-blue-300 hover:underline wrap-break-word whitespace-normal leading-normal break-all min-w-0"
                              >
                                <FileText className="h-3.5 w-3.5 text-[#0f62fe] dark:text-blue-300 stroke-2 shrink-0 mt-0.5" />
                                <span className="wrap-break-word whitespace-normal break-all min-w-0">{att.name}</span>
                              </a>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => attachInputRefs.current[enquiry.id]?.click()}
                          className="inline-flex items-center gap-0.5 self-start shrink-0 text-[10px] font-semibold text-[#0f62fe] dark:text-blue-300 hover:underline cursor-pointer"
                        >
                          <Plus className="h-3 w-3 stroke-[2.5]" />
                          Add
                        </button>
                        <input
                          ref={(el) => {
                            if (el) attachInputRefs.current[enquiry.id] = el;
                          }}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleAddAttachments(e, enquiry.id)}
                        />
                      </div>
                    </td>

                    {/* Delivery Schedule */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.deliverySchedule || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "deliverySchedule", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.deliverySchedules
                            .filter((opt) => opt !== "-")
                            .map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* APM - beside Offer PDF (enquiry-based) — admin/developer only */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          disabled={!canEditApm}
                          title={canEditApm ? "Set APM Yes" : "Admin only — please login"}
                          onClick={() => canEditApm && handleEnquiryFieldChange(enquiry.id, "apm", (enquiry as any).apm === "Yes" ? "" : "Yes")}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${!canEditApm ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${
                            (enquiry as any).apm === "Yes"
                              ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                              : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          disabled={!canEditApm}
                          title={canEditApm ? "Set APM No" : "Admin only — please login"}
                          onClick={() => canEditApm && handleEnquiryFieldChange(enquiry.id, "apm", (enquiry as any).apm === "No" ? "" : "No")}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${!canEditApm ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${
                            (enquiry as any).apm === "No"
                              ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                              : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                          }`}
                        >
                          No
                        </button>
                      </div>
                      {!canEditApm && <div className="text-[9px] text-center text-muted-foreground mt-1">ðŸ”’ admin only</div>}
                    </td>

                    {/* Offer PDF */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <OfferPdfCell enquiry={enquiry} />
                    </td>

                    {/* Duplicate */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <div className="flex flex-col gap-1">
                        <select
                          value={enquiry.duplicate || ""}
                          onChange={(e) => handleEnquiryFieldChange(enquiry.id, "duplicate", e.target.value)}
                          className={cellSelectClass}
                          title="Mark this docket as a duplicate"
                        >
                          <option value="">-</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                        {enquiry.duplicate === "Yes" && (
                          <>
                            <select
                              value={enquiry.duplicateOfDocket || ""}
                              onChange={(e) =>
                                handleEnquiryFieldChange(enquiry.id, "duplicateOfDocket", e.target.value)
                              }
                              className={cellSelectClass}
                              title="Select the original docket this duplicates"
                            >
                              <option value="">- original -</option>
                              {enquiries
                                .filter((e) => e.id !== enquiry.id)
                                .map((e) => (
                                  <option key={e.id} value={e.docketNumber}>
                                    {e.docketNumber}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              disabled={
                                deletingEnquiryId === enquiry.id ||
                                !enquiry.duplicateOfDocket ||
                                (enquiry.items?.length ?? 0) > 0
                              }
                              onClick={() => handleDeleteDuplicate(enquiry)}
                              className="inline-flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-500/20 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              title={
                                (enquiry.items?.length ?? 0) > 0
                                  ? "Cannot delete: this docket has items"
                                  : !enquiry.duplicateOfDocket
                                    ? "Select the original docket first"
                                    : "Delete this blank duplicate docket"
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete duplicate
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right border-b border-border">
                      {firstItem && (
                        <ActionsDropdown
                          item={firstItem}
                          enquiry={enquiry}
                          dropdownOptions={dropdownOptions}
                        />
                      )}
                    </td>
                  </tr>

                  {/* Additional Items Sub-Rows */}
                  {isExpanded &&
                    hasMultiple &&
                    displayItems.slice(1).map((item: EnquiryItemData, idx: number) => (
                      <tr
                        key={item.id}
                        className={`transition-colors ${invalidVaItemIds.has(item.id) ? "bg-red-100 dark:bg-red-500/15" : "bg-muted/10 hover:bg-muted/20"}`}
                      >
                        {/* Select checkbox for this item + empty cells for docket info alignment */}
                        <td className="py-3 px-2 text-center border-r border-b border-border">
                          <input
                            type="checkbox"
                            checked={isItemSelected(item.id)}
                            onChange={() => toggleItemSelection(enquiry.id, item.id)}
                            className="h-3.5 w-3.5 rounded border-border text-[#0f62fe] dark:text-blue-300 focus:ring-blue-500 cursor-pointer"
                            title={isItemSelected(item.id) ? "Deselect item" : "Select item"}
                          />
                        </td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Additional Item Name */}
                        <td className="py-2 px-2 text-xs text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top">
                          {editingItemNameId === item.id ? (
                            <input
                              type="text"
                              defaultValue={item.itemName}
                              autoFocus
                              onBlur={(e) => {
                                if (e.target.value.trim() !== item.itemName) {
                                  handleItemFieldChange(item.id, "itemName", e.target.value.trim());
                                }
                                setEditingItemNameId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.target as HTMLInputElement).blur();
                                } else if (e.key === "Escape") {
                                  setEditingItemNameId(null);
                                }
                              }}
                              className="w-full bg-background border border-blue-500 text-xs text-foreground outline-none p-1 rounded font-medium"
                            />
                          ) : (
                            <div className="flex items-center justify-between w-full group truncate">
                              <div className="w-full pr-1 wrap-break-word whitespace-normal leading-normal">
                                {item.itemName}
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingItemNameId(item.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-1.5 align-middle"
                                title="Edit item name"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        
                        {/* Details */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
                          <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              type:
                              <select
                                value={item.itemType || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "itemType", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.itemTypes.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              moc:
                              <select
                                value={item.moc || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "moc", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.mocs.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              size:
                              <select
                                value={item.size || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "size", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.sizes.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              pn_rating:
                              <select
                                value={item.pnRating || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "pnRating", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.pnRatings.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              operation_type:
                              <select
                                value={item.operationType || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "operationType", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.operationTypes.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              extension:
                              <select
                                value={item.extension || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "extension", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.extensions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              bypass:
                              <select
                                value={item.bypass || ""}
                                onChange={(e) => handleItemFieldChange(item.id, "bypass", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {dropdownOptions.bypasses.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              other:
                              <div className="min-w-28">
                                <OthersInlineMultiSelect
                                  value={(item as any).others || []}
                                  options={(dropdownOptions as any).others || ["flange", "gasket", "nut and bolt"]}
                                  onChange={(next) => {
                                    const prev = ((item as any).others || []) as string[];
                                    if (JSON.stringify(prev.slice().sort()) !== JSON.stringify(next.slice().sort())) {
                                      handleItemFieldChange(item.id, "others", JSON.stringify(next));
                                    }
                                  }}
                                />
                              </div>
                            </div>
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                              rm_type:
                              <select
                                value={item.rmType || ""}
                                disabled={isFrozen}
                                onChange={(e) => handleItemFieldChange(item.id, "rmType", e.target.value)}
                                className="bg-transparent border-none text-xs text-foreground outline-none cursor-pointer rounded px-0.5 py-0 hover:bg-muted/80 transition-colors normal-case font-medium"
                              >
                                <option value="">-</option>
                                {item.rmType && !RM_TYPE_OPTIONS.includes(item.rmType) && (
                                  <option value={item.rmType}>{item.rmType}</option>
                                )}
                                {RM_TYPE_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </td>

                        {/* Additional Item Quantity */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-quantity-" + (item.quantity || "")}
                            type="text"
                            defaultValue={item.quantity ? Number(item.quantity).toString() : ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (item.quantity ? Number(item.quantity).toString() : "")) {
                              handleItemFieldChange(item.id, "quantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        </td>

                        {/* Item Code (read-only) */}
                        <ItemCodeCell item={item} />

                        {/* BOM ID (dropdown when multiple, else read-only) */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          {(() => {
                            const avail = (item as any).availableBomIds as string[] | undefined;
                            const hasMulti = Array.isArray(avail) && avail.length > 1;
                            if (hasMulti) {
                              return (
                                <select
                                  value={(item as any).bomId || ""}
                                  disabled={isFrozen}
                                  title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : (avail || []).join(", ")}
                                  onChange={(e) => {
                                    if (isFrozen) { toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit."); return; }
                                    const v = e.target.value || null;
                                    toast.promise(dispatch(selectBomId({ itemId: item.id, bomId: v })).unwrap(), {
                                      loading: "Saving BOM...",
                                      success: "BOM saved.",
                                      error: (err) => (typeof err === "string" ? err : err?.message || "Failed to save BOM."),
                                    });
                                  }}
                                  className="w-full text-[10px] border border-border rounded px-1 py-1 bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <option value="">-- select --</option>
                                  {avail!.map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                  ))}
                                </select>
                              );
                            }
                            return <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={(item as any).bomId || ""}>{(item as any).bomId || "-"}</span>;
                          })()}
                        </td>

                        {/* Product Cost */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-productCost-" + (item.productCost !== null && item.productCost !== undefined ? Number(item.productCost).toString() : "")}
                            type="text"
                            defaultValue={formatIndianNumber(item.productCost)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, item.productCost)) {
                              handleItemFieldChange(item.id, "productCost", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Cost Ref Code */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-costRefCode-" + (item.costRefCode || "")}
                            type="text"
                            defaultValue={item.costRefCode || ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (item.costRefCode || "")) {
                              handleItemFieldChange(item.id, "costRefCode", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Cost */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-cost-" + (item.cost !== null && item.cost !== undefined ? Number(item.cost).toString() : "")}
                            type="text"
                            defaultValue={formatIndianNumber(item.cost)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, item.cost)) {
                              handleItemFieldChange(item.id, "cost", next);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Stock Status */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-stockStatus-" + (item.stockStatus || "")}
                            type="text"
                            defaultValue={item.stockStatus || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.stockStatus || "")) {
                              handleItemFieldChange(item.id, "stockStatus", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      </td>

                      {/* Stock Quantity */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-stockQuantity-" + (item.stockQuantity || "")}
                            type="text"
                            defaultValue={item.stockQuantity || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.stockQuantity || "")) {
                              handleItemFieldChange(item.id, "stockQuantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Available Stock */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-availableStock-" + (item.availableStock || "")}
                            type="text"
                            defaultValue={item.availableStock || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.availableStock || "")) {
                              handleItemFieldChange(item.id, "availableStock", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* View Image */}
                      <ItemImageCells item={item} image={getItemImage(item)} />

                      {/* Stock Against Contract */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-stockAgainstContract-" + (item.stockAgainstContract || "")}
                            type="text"
                            defaultValue={item.stockAgainstContract || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.stockAgainstContract || "")) {
                              handleItemFieldChange(item.id, "stockAgainstContract", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Discount */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-discount-" + (item.discount !== null && item.discount !== undefined ? Number(item.discount).toString() : "")}
                            type="text"
                            defaultValue={item.discount !== null && item.discount !== undefined ? Number(item.discount).toString() : ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            if (e.target.value !== (item.discount !== null && item.discount !== undefined ? Number(item.discount).toString() : "")) {
                              handleItemFieldChange(item.id, "discount", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* VA% */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 font-semibold ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-vaPercent-" + (item.vaPercent !== null ? `${item.vaPercent}%` : "")}
                            type="text"
                            defaultValue={item.vaPercent !== null ? `${item.vaPercent}%` : ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (item.vaPercent !== null ? `${item.vaPercent}%` : "")) {
                              handleItemFieldChange(item.id, "vaPercent", val);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Quoted Rate */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-" + (item.quotedRate || "")}
                            type="text"
                            defaultValue={formatIndianNumber(item.quotedRate)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, item.quotedRate)) {
                              handleItemFieldChange(item.id, "quotedRate", next);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* CR Rate (Contract Review Rate — read-only) */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-violet-700 dark:text-violet-300 p-1 font-medium text-right">
                            {formatIndianNumber(item.contractReviewRate) || "-"}
                          </span>
                        </td>

                      {/* PD Cost Validation (read-only) */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-blue-700 dark:text-blue-300 p-1 font-medium text-right">
                            {getPdCostValidation(item) || "-"}
                          </span>
                        </td>

                      {/* QR incl. GST */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-foreground p-1 font-medium text-right">
                            {formatIndianNumber(item.quotedRateGst) || "-"}
                          </span>
                        </td>

                        {/* Item Name Merge */}
                        <td className="py-3 px-3 border-r border-b border-border last:border-r-0 text-xs text-muted-foreground font-medium truncate">
                          {getItemNameMerge(item) || "-"}
                        </td>

                        {/* Total Value */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-totalValue-" + (item.totalValue || "")}
                            type="text"
                            defaultValue={formatIndianNumber(item.totalValue)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, item.totalValue)) {
                              handleItemFieldChange(item.id, "totalValue", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Itemwise Total Value */}
                        <td className={`py-2 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <input
                            key={item.id + "-itemWiseTotalValue-" + (item.itemWiseTotalValue || "")}
                            type="text"
                            defaultValue={formatIndianNumber(item.itemWiseTotalValue)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onBlur={(e) => {
                            const next = cleanNumberInput(e.target.value);
                            if (hasNumberChanged(next, item.itemWiseTotalValue)) {
                              handleItemFieldChange(item.id, "itemWiseTotalValue", next);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Validation */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleItemFieldChange(item.id, "validation", item.validation === "Yes" ? "" : "Yes")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "Yes"
                                  ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                                  : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => handleItemFieldChange(item.id, "validation", item.validation === "No" ? "" : "No")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "No"
                                  ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                                  : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                              }`}
                            >
                              No
                            </button>
                          </div>
                        </td>

                      {/* Empty attachment column (enquiry-level) */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Delivery Schedule */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.deliverySchedule || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "deliverySchedule", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.deliverySchedules
                              .filter((opt) => opt !== "-")
                              .map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                          </select>
                        </td>

                      {/* Empty APM column - enquiry-based, only parent row has controls */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                      {/* Empty Offer PDF column */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                      {/* Empty Duplicate column (enquiry-based, only parent row has controls) */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Actions on this item */}
                        <td className="py-3.5 px-4 text-right border-b border-border">
                          <ActionsDropdown
                            item={item}
                            enquiry={enquiry}
                            dropdownOptions={dropdownOptions}
                          />
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {filteredEnquiries.length > 0 && (
      <div className="shrink-0 border-t border-border bg-card">
        <Pagination
          currentPage={currentPage}
          totalCount={filteredEnquiries.length}
          pageSize={pageSize}
          onPageChange={(page) => dispatch(setPage(page))}
          onPageSizeChange={(size) => {
            dispatch(setPageSize(size));
            dispatch(setPage(1));
          }}
        />
      </div>
    )}

    {/* Bulk Delete Confirm Dialog — per enquiry, filtered scope, persisted */}
    <Dialog open={bulkConfirmOpen} onOpenChange={(v) => { if (!v) setBulkConfirmOpen(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Confirm Bulk Delete
          </DialogTitle>
        </DialogHeader>
        {(() => {
          const selEnquiry = enquiries.find((e) => e.id === validSelectedEnquiryId);
          const selItems = selEnquiry ? selEnquiry.items.filter((it) => validSelectedItemIds.has(it.id)) : [];
          const allFilteredForEnquiry = selEnquiry ? getFilteredItems(selEnquiry) : [];
          const willEmptyEnquiry = selEnquiry ? selItems.length === selEnquiry.items.length : false;
          return (
            <div className="py-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                {selEnquiry ? (
                  <>Delete <span className="font-bold text-foreground">{validSelectedItemIds.size}</span> selected item(s) from docket <span className="font-bold text-foreground">"{selEnquiry.docketNumber}"</span>?</>
                ) : (
                  <>No enquiry selected.</>
                )}
              </p>
              {selItems.length > 0 && (
                <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded border border-border bg-muted/30 p-2 space-y-1 min-w-0">
                  {selItems.map((it) => (
                    <div key={it.id} className="text-xs text-foreground flex items-start gap-1.5 min-w-0 overflow-hidden">
                      <span className="text-muted-foreground shrink-0">•</span>
                      <span className="truncate min-w-0 flex-1">{it.itemName}</span>
                    </div>
                  ))}
                </div>
              )}
              {willEmptyEnquiry ? (
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded p-2">
                  Note: This will remove all items from enquiry "{selEnquiry?.docketNumber}". The enquiry will remain with 0 items and you can add items later. This cannot be undone.
                </p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                  {allFilteredForEnquiry.length !== selItems.length ? `Note: ${allFilteredForEnquiry.length} filtered items in this enquiry, ${selItems.length} selected.` : null}
                  {" "}This action cannot be undone.
                </p>
              )}
            </div>
          );
        })()}
        <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={bulkDeleting} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={bulkDeleting || validSelectedItemIds.size === 0}
            onClick={handleBulkDeleteConfirm}
          >
            {bulkDeleting ? "Deleting..." : `Delete ${validSelectedItemIds.size} Item(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Clear Quoted Rate Confirm Dialog — filtered scope, VA% preserved */}
    <Dialog open={clearQrConfirmOpen} onOpenChange={(v) => { if (!v && !clearQrRunning) { setClearQrConfirmOpen(false); setClearQrPending(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Confirm Clear Quoted Rates
          </DialogTitle>
        </DialogHeader>
        <div className="py-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Clear <span className="font-bold text-foreground">{clearQrPending?.withQr ?? 0}</span> Quoted Rate(s) from <span className="font-bold text-foreground">{clearQrPending?.total ?? 0}</span> filtered item(s) across all pages?
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded p-2">
            This will delete <span className="font-semibold">Quotation Rate, QR incl. GST, Total Value</span> and <span className="font-semibold">Itemwise Total</span> from the database for filtered items only. <span className="font-semibold">VA% will be kept</span>. This cannot be undone without re-entering rates.
          </p>
          {(() => {
            const allFiltered = filteredEnquiries.flatMap((e) => getFilteredItems(e));
            const withQrItems = allFiltered.filter((i) => i.quotedRate != null && String(i.quotedRate).trim() !== "").slice(0, 8);
            if (withQrItems.length === 0) return null;
            return (
              <div className="max-h-32 overflow-y-auto rounded border border-border bg-muted/30 p-2 space-y-1">
                {withQrItems.map((it) => (
                  <div key={it.id} className="text-xs text-foreground truncate flex items-start gap-1.5">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span className="truncate">{it.itemName} — QR: {it.quotedRate}</span>
                  </div>
                ))}
                {clearQrPending && clearQrPending.withQr > 8 && (
                  <div className="text-[11px] text-muted-foreground font-medium pt-1">+{clearQrPending.withQr - 8} more...</div>
                )}
              </div>
            );
          })()}
        </div>
        <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={clearQrRunning} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={clearQrRunning || !clearQrPending}
            onClick={handleClearQrConfirm}
          >
            {clearQrRunning ? "Clearing..." : `Clear ${clearQrPending?.withQr ?? 0} Rate(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
  );
}

function triggerDownload(base64: string, fileName: string) {
  const byteChars = atob(base64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNums);
  const blob = new Blob([byteArray], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function OfferPdfCell({ enquiry }: { enquiry: EnquiryData }) {
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const storeItems = useAppSelector(selectAllItems);
  const items = storeItems.filter((item: EnquiryItemData) => item.enquiryId === enquiry.id);
  const apm = (enquiry as any).apm as string | null | undefined;
  const generatedAt = (enquiry as any).offerPdfGeneratedAt as string | Date | null | undefined;
  const access = oneClickAccess(apm ?? null, generatedAt ?? null);
  const dispatch = useAppDispatch();

  const handleGenerate = async () => {
    setStatus("generating");
    try {
      // Map data into OfferLetterTemplateData shape
      const rowData: OfferLetterTemplateData = {
        docketNo: enquiry.docketNumber,
        state: enquiry.state || "",
        partyName: enquiry.partyName,
        subject: `Offer For Supply under @ ${enquiry.utility || ""}`,
        price: "The Quoted prices are on Firm basis, valid for 60days.",
        paymentTerms: enquiry.paymentTerms || "",
        inspection: enquiry.inspection || "",
        warranty: (() => {
          const pbg = enquiry.pbg;
          let months = 18;
          if (pbg && pbg !== "NA") {
            const match = pbg.match(/For\s+(\d+)\s+Months?/i);
            if (match) {
              months = parseInt(match[1], 10);
            }
          }
          return `The warranty shall be valid as per the standard maintenance clause on our website and to the maximum period of ${months} months from the date of supply.`;
        })(),
        approval: "It shall be in our scope",
        deliveryDestination: enquiry.state || "",
        items: items.map((item: EnquiryItemData) => ({
          itemName: item.itemName,
          partyItemName: item.itemNameMerge || "",
          quantity: item.quantity ? Number(item.quantity) : 0,
          quotationRate: item.quotedRate ? parseFloat(item.quotedRate) : 0,
          quotedRateGst: item.quotedRateGst ? parseFloat(item.quotedRateGst) : 0,
          totalValue: item.totalValue ? parseFloat(item.totalValue) : 0,
          unit: "Nos.",
          deliverySchedule: item.deliverySchedule || "2-3 weeks",
        })),
        totalItemwiseValue: items.reduce((sum: number, item: EnquiryItemData) => {
          const qty = item.quantity ? Number(item.quantity) : 0;
          const rate = item.quotedRate ? parseFloat(item.quotedRate) : 0;
          return sum + qty * rate;
        }, 0),
      };

      const res = await generateOfferPdfAction(rowData, enquiry.id);
      if (res.success && res.pdfBase64) {
        triggerDownload(res.pdfBase64, res.fileName);
        // After Yes one-time, reload to reflect frozen state (server updated offerPdfGeneratedAt)
        if (apm === "Yes") {
          // optimistic: page reload enquiries after short delay to show frozen badge
          setTimeout(() => window.location.reload(), 800);
        }
        setStatus("idle");
      } else {
        setErrorMessage(res.error || "Generation failed");
        setStatus("error");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
      setStatus("error");
    }
  };

  // Frozen/disabled states before idle render
  if (!access.allowed) {
    const isFrozen = apm === "Yes" && !!generatedAt;
    const isNo = apm === "No";
    return (
      <div className="flex flex-col items-center gap-1 py-1" title={access.reason || ""}>
        <span className={`text-[9px] font-bold px-2 py-1 rounded border ${isFrozen ? "bg-muted text-muted-foreground border-border" : "bg-rose-50 text-rose-700 border-rose-200 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"}`}>
          {isFrozen ? "Frozen" : isNo ? "Disabled (APM No)" : access.reason}
        </span>
        {isFrozen && generatedAt && <span className="text-[8px] text-muted-foreground">{new Date(generatedAt as any).toLocaleString()}</span>}
        {isNo && <span className="text-[8px] text-muted-foreground">APM=No blocks offer</span>}
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <button
          type="button"
          onClick={async () => { await handleGenerate(); // refresh enquiry so frozen state shows without reload
            try { const { updateEnquiryField } = await import("@/lib/enquiriesSlice"); // trigger refetch via page refresh not ideal; optimistic: reload enquiries
            } catch {} }}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#0f62fe] border border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:border-blue-500/25 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded cursor-pointer transition-all whitespace-nowrap"
        >
          <FileText className="h-3.5 w-3.5 stroke-[2.5]" />
          Generate PDF
        </button>
        {apm === "Yes" && !generatedAt && <span className="text-[8px] text-amber-600 dark:text-amber-300 font-medium">One-time only</span>}
        {(!apm || apm === "") && <span className="text-[8px] text-muted-foreground">Unlimited (APM empty)</span>}
      </div>
    );
  }

  if (status === "generating") {
    return (
      <div className="flex items-center gap-1.5 justify-center py-1">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="text-[10px] text-muted-foreground font-medium animate-pulse">Generating...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-1">
        <span className="text-[9px] text-red-500 dark:text-red-300 font-medium truncate max-w-[100px]" title={errorMessage}>{errorMessage}</span>
        <button
          type="button"
          onClick={handleGenerate}
          className="text-[9px] text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
