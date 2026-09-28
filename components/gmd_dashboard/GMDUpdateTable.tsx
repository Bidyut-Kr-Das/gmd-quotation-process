"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { ChevronUp, ChevronDown, Search, RotateCcw, X, Download, Files, FileText, ExternalLink, Copy, Upload, Eye, Paperclip, Trash2, ImageIcon, Check } from "lucide-react";
import GMDUpdateStatusBadge from "./GMDUpdateStatusBadge";
import type { ContractReviewImage } from "@/lib/gmd_lib/contract-review-image-lookup";
import {
  STATUS_COLUMNS,
  NUMERIC_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
} from "../../lib/gmd_lib/sheet-columns";
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_ZERO,
  FLOW_NON_ZERO,
  cellHasValue,
  cellIsZero,
} from "../../lib/gmd_lib/flowFilter";
import {
  BOM_ID_COLUMN,
  BOM_ID_FILTER_VALUES,
  getBomIdCategory,
} from "../../lib/gmd_lib/bomCategory";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import Pagination from "./Pagination";
import { useAppDispatch } from "@/lib/hooks";
import { updateGMDUpdateField, updateGMDUsdCost } from "@/lib/gmdUpdateSlice";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DatePicker from "@/components/ui/date-picker";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderLinksCell(display: string) {
  const parts = display
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const linkParts = parts.filter(isUrl);
  if (linkParts.length === 0) return null;
  // Mix of links and non-links: render links as anchors, others as text, comma separated
  return (
    <span className="block break-all" title={display}>
      {parts.map((part, idx) => (
        <span key={`${part}-${idx}`}>
          {isUrl(part) ? (
            <a
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-blue-600 hover:text-blue-800"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          ) : (
            <span>{part}</span>
          )}
          {idx < parts.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

function OrderListCell({ display, poNo }: { display: string; poNo?: string }) {
  const links = useMemo(
    () => display.split(",").map((s) => s.trim()).filter(Boolean).filter(isUrl),
    [display]
  );
  const [open, setOpen] = useState(false);
  if (links.length === 0) {
    return <span className="truncate block text-gray-400" title={display}>—</span>;
  }
  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        className="h-6 text-[11px] gap-1.5 px-2 font-semibold border-[#0a2540]/15 bg-white hover:bg-[#f4f6f8] text-[#0a2540]"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={links.join(", ")}
      >
        <Files size={12} className="shrink-0" />
        {links.length === 1 ? "View File" : `View Files (${links.length})`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-130 p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-[#e1e6eb] bg-[#f8f9fa]">
            <DialogTitle className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
              <FileText size={16} className="text-[#0a2540]/70" />
              {poNo ? `Attachments — ${poNo}` : `Attachments`}
              <span className="ml-1 text-xs font-semibold text-[#0a2540]/60">({links.length})</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {links.length === 1 ? "1 file linked to this PO" : `${links.length} files linked to this PO`} from GMD Clientwise
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#e1e6eb]">
            {links.map((url, idx) => {
              const shortId = (() => {
                try {
                  const u = new URL(url);
                  const id = u.searchParams.get("id") || u.pathname.split("/").pop() || url;
                  return id.length > 18 ? id.slice(0, 18) + "…" : id;
                } catch {
                  return url.length > 32 ? url.slice(0, 32) + "…" : url;
                }
              })();
              return (
                <div key={`${url}-${idx}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#f8f9fa] transition-colors">
                  <div className="shrink-0 w-8 h-8 rounded bg-[#eef2f7] border border-[#e1e6eb] flex items-center justify-center text-[#0a2540]/70">
                    <FileText size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[#0a2540]">File {idx + 1}</div>
                    <div className="text-[11px] text-muted-foreground truncate" title={url}>{shortId}</div>
                    <div className="text-[10px] text-[#0a2540]/50 truncate" title={url}>{url}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-7 px-2 gap-1 text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(url);
                      }}
                      title="Copy link"
                    >
                      <Copy size={12} /> Copy
                    </Button>
                    <Button
                      variant="default"
                      size="xs"
                      className="h-7 px-2.5 gap-1 text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      title="Open file"
                    >
                      <ExternalLink size={12} /> Open
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemImageCell({
  images,
  code,
}: {
  images: ContractReviewImage[];
  code: string;
}) {
  const [open, setOpen] = useState(false);
  if (images.length === 0) {
    return (
      <span className="truncate block" title={code}>
        {code || "—"}
      </span>
    );
  }
  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="truncate" title={code}>
        {code}
      </span>
      <Button
        variant="outline"
        size="xs"
        className="h-6 shrink-0 px-1.5 font-semibold border-[#0a2540]/15 bg-white hover:bg-[#f4f6f8] text-[#0a2540]"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={images
          .map(
            (i) =>
              `${i.itemType ?? ""} / ${i.operationType ?? ""} / ${i.rmType ?? ""}`,
          )
          .join("\n")}
      >
        <ImageIcon size={12} className="shrink-0" />
        {images.length === 1 ? "Image" : `Images (${images.length})`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-[#e1e6eb] bg-[#f8f9fa]">
            <DialogTitle className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
              <ImageIcon size={16} className="text-[#0a2540]/70" />
              Images — {code}
              <span className="ml-1 text-xs font-semibold text-[#0a2540]/60">
                ({images.length})
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Item images linked to this item code from Quotation Process
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#e1e6eb]">
            {images.map((image, idx) => {
              const href =
                image.url ??
                (image.driveFileId
                  ? `https://drive.google.com/file/d/${image.driveFileId}/view`
                  : null);
              const combo = [
                image.itemType,
                image.operationType,
                image.rmType,
              ]
                .map((p) => (p ?? "").trim())
                .filter(Boolean)
                .join(" / ");
              return (
                <div
                  key={`${image.imageKey}-${idx}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#f8f9fa] transition-colors"
                >
                  <div className="shrink-0 w-10 h-10 rounded border border-[#e1e6eb] bg-[#eef2f7] overflow-hidden flex items-center justify-center">
                    {image.driveFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://drive.google.com/thumbnail?id=${image.driveFileId}&sz=w400`}
                        alt={combo || "item image"}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <ImageIcon size={14} className="text-[#0a2540]/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-semibold text-[#0a2540] truncate"
                      title={combo}
                    >
                      {combo || "Unlabelled image"}
                    </div>
                    <div
                      className="text-[10px] text-[#0a2540]/50 truncate"
                      title={image.imageKey}
                    >
                      {image.imageKey}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {href ? (
                      <>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-7 px-2 gap-1 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(href);
                          }}
                          title="Copy link"
                        >
                          <Copy size={12} /> Copy
                        </Button>
                        <Button
                          variant="default"
                          size="xs"
                          className="h-7 px-2.5 gap-1 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(href, "_blank", "noopener,noreferrer");
                          }}
                          title="Open in Drive"
                        >
                          <ExternalLink size={12} /> Open
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] italic text-muted-foreground">
                        No link
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentCell({
  url,
  onUpload,
  onClear,
  accept,
  verdict,
  onSetVerdict,
}: {
  url: string;
  onUpload: (file: File) => void;
  onClear: () => void;
  accept?: string;
  verdict?: string | null;
  onSetVerdict?: (verdict: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isPdf = /\.pdf($|\?)/i.test(url);

  const buttonClass =
    "flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold rounded border cursor-pointer transition-colors";

  const hasVerdict = onSetVerdict != null;
  const verdictDisabled = hasVerdict && !url;

  const verdictBoxClass = (active: boolean, tone: "emerald" | "rose") => {
    if (verdictDisabled) {
      return "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-[#e1e6eb] bg-[#f4f6f8] text-[#c2c9d0] cursor-not-allowed";
    }
    if (active) {
      return tone === "emerald"
        ? "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-emerald-500 bg-emerald-500 text-white cursor-pointer transition-colors hover:bg-emerald-600"
        : "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-rose-500 bg-rose-500 text-white cursor-pointer transition-colors hover:bg-rose-600";
    }
    return tone === "emerald"
      ? "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-emerald-200 bg-emerald-50 text-emerald-600 cursor-pointer transition-colors hover:bg-emerald-100"
      : "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-rose-200 bg-rose-50 text-rose-600 cursor-pointer transition-colors hover:bg-rose-100";
  };

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <div className="flex items-center justify-center gap-1">
      <input
        ref={fileRef}
        type="file"
        accept={accept ?? ".pdf,image/png,image/jpeg,image/webp"}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      {url ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={`${buttonClass} border-[#0a2540]/15 bg-white text-[#0a2540] hover:bg-[#f4f6f8]`}
            title="Preview attachment"
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            className={`${buttonClass} border-[#e1e6eb] bg-white text-[#0a2540]/70 hover:bg-[#f4f6f8]`}
            title="Replace attachment"
          >
            <Upload size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className={`${buttonClass} border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}
            title="Remove attachment"
          >
            <Trash2 size={11} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current?.click();
          }}
          className={`${buttonClass} border-[#0a2540]/15 bg-white text-[#0a2540] hover:bg-[#f4f6f8]`}
          title="Upload PDF or image"
        >
          <Paperclip size={12} />
          Upload
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-180 p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-[#e1e6eb] bg-[#f8f9fa]">
            <DialogTitle className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
              <FileText size={16} className="text-[#0a2540]/70" />
              Attachment Preview
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isPdf ? "PDF document" : "Image"} stored in the S3 bucket
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto bg-[#f4f6f8]">
            {isPdf ? (
              <iframe
                src={url}
                className="w-full h-[65vh]"
                title="Attachment preview"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="Attachment preview"
                className="mx-auto max-h-[65vh] object-contain"
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e1e6eb]">
            <Button
              variant="ghost"
              size="xs"
              className="h-7 px-2 gap-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(url);
                toast.success("Link copied");
              }}
            >
              <Copy size={12} /> Copy link
            </Button>
            <Button
              variant="default"
              size="xs"
              className="h-7 px-2.5 gap-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink size={12} /> Open
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
      {hasVerdict ? (
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            title={
              verdictDisabled
                ? "Upload a diagram first"
                : verdict === "CORRECT"
                  ? "Marked correct - click to clear"
                  : "Mark diagram as correct"
            }
            aria-label="Mark diagram as correct"
            aria-pressed={!verdictDisabled && verdict === "CORRECT"}
            disabled={verdictDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onSetVerdict(verdict === "CORRECT" ? null : "CORRECT");
            }}
            className={verdictBoxClass(verdict === "CORRECT", "emerald")}
          >
            <Check size={13} strokeWidth={3} />
          </button>
          <button
            type="button"
            title={
              verdictDisabled
                ? "Upload a diagram first"
                : verdict === "WRONG"
                  ? "Marked wrong - click to clear"
                  : "Mark diagram as wrong"
            }
            aria-label="Mark diagram as wrong"
            aria-pressed={!verdictDisabled && verdict === "WRONG"}
            disabled={verdictDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onSetVerdict(verdict === "WRONG" ? null : "WRONG");
            }}
            className={verdictBoxClass(verdict === "WRONG", "rose")}
          >
            <X size={13} strokeWidth={3} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function parseDate(str: string): Date | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  // Primary: DD-Mmm-YY / DD-Mmm-YYYY e.g. 12-Jan-24, 05-Feb-2023 (supply sheet format)
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const mon = months[m[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m[1], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      if (!isNaN(day) && day >= 1 && day <= 31 && !isNaN(year)) {
        return new Date(year, mon, day);
      }
    }
  }
  // Fallback: ISO / locale strings (e.g. 2024-01-12)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

const EMPTY_DATE_RANGES: Record<
  string,
  { from: string; to: string; blank?: boolean }
> = {};

const DATE_SORT_HEADERS = new Set(["Date", "expiryDate", "PBG VALID TILL", "PBG CLAIM TILL"]);
function isDateHeader(header: string): boolean {
  if (DATE_SORT_HEADERS.has(header)) return true;
  const l = header.toLowerCase();
  return l.includes("date") || l.includes("warranty");
}

function compareDates(aVal: unknown, bVal: unknown, dir: number): number {
  const aStr = String(aVal ?? "").trim();
  const bStr = String(bVal ?? "").trim();
  const aD = aStr ? parseDate(aStr) : null;
  const bD = bStr ? parseDate(bStr) : null;
  const aT = aD ? aD.getTime() : null;
  const bT = bD ? bD.getTime() : null;
  const aNull = aT === null || isNaN(aT as number);
  const bNull = bT === null || isNaN(bT as number);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (aT === bT) return 0;
  return (aT! < bT! ? -1 : 1) * dir;
}

function cellCompare(aVal: unknown, bVal: unknown, dir: number): number {
  const aNum = typeof aVal === "number" ? aVal : NaN;
  const bNum = typeof bVal === "number" ? bVal : NaN;
  if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * dir;
  const aKey = isNaN(aNum) ? String(aVal ?? "").toLowerCase() : "";
  const bKey = isNaN(bNum) ? String(bVal ?? "").toLowerCase() : "";
  const aNull = aKey === "" && isNaN(aNum);
  const bNull = bKey === "" && isNaN(bNum);
  if (aNull && bNull) return 0;
  if (aNull) return dir;
  if (bNull) return -dir;
  return aKey.localeCompare(bKey, undefined, { numeric: true }) * dir;
}

function cellEq(rowA: unknown[], rowB: unknown[], colIdx: number): boolean {
  return String(rowA[colIdx] ?? "") === String(rowB[colIdx] ?? "");
}

export interface ColumnGroupChild {
  header: string;
  /** Short caption shown next to the field inside the collapsed cell. */
  label?: string;
}

export interface ColumnGroup {
  /** Parent header caption. */
  label: string;
  /** Rendered width of the single collapsed column. */
  width?: number;
  children: ColumnGroupChild[];
}

/** A rendered column: either a standalone header, or a collapsed group. */
interface ResolvedCol {
  header: string;
  idx: number;
  group?: ColumnGroup & { children: ColumnGroupChild[] };
}

const DEFAULT_GROUP_WIDTH = 320;
const FROZEN_VISIBLE_COLUMNS = 2;

function MultiSelect({
  options,
  selected,
  onChange,
  optionMeta,
}: {
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  optionMeta?: Record<
    string,
    { count: number; sumLabel: string; partyName?: string }
  >;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="w-full text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 text-left outline-none cursor-pointer truncate"
      >
        {selected.length ? `${selected.length} selected` : "All"}
      </button>
      {open && (
        <div
          className={`absolute top-full left-0 z-50 mt-1 bg-white border border-[#e1e6eb] rounded shadow-lg ${
            optionMeta ? "min-w-64 max-w-104" : "w-48"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center px-1 py-1.5 text-[10px] border-b border-[#e1e6eb]">
            <button
              type="button"
              onClick={() => onChange([...options])}
              className="text-blue-600 font-bold hover:underline cursor-pointer"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-red-600 font-semibold hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <label className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[10px]">
              <input
                type="checkbox"
                checked={selected.includes("(Blank)")}
                onChange={() => {
                  const next = selected.includes("(Blank)")
                    ? selected.filter((v) => v !== "(Blank)")
                    : [...selected, "(Blank)"];
                  onChange(next);
                }}
                className="accent-blue-600"
              />
              <span className="italic text-gray-400">(Blank)</span>
            </label>
            {options.map((opt) => {
              const meta = optionMeta?.[opt];
              return (
                <label
                  key={opt}
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[10px]"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => {
                      const next = selected.includes(opt)
                        ? selected.filter((v) => v !== opt)
                        : [...selected, opt];
                      onChange(next);
                    }}
                    className="accent-blue-600"
                  />
                  <span className="flex-1 min-w-0 leading-tight">
                    <span className="block truncate font-medium">{opt}</span>
                    {meta && (
                      <>
                        <span className="block text-[9px] text-[#0a2540]/60 truncate">
                          {meta.partyName || "—"}
                        </span>
                        <span className="block text-[9px] text-[#0a2540]/80">
                          {meta.count} · {meta.sumLabel}
                        </span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface GMDUpdateTableProps {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  title?: string;
  editable?: boolean;
  editableColumns?: string[];
  hiddenFilters?: string[];
  hiddenColumns?: string[];
  groupByColumn?: string;
  mergeColumns?: string[];
  mergeTypeColumn?: string;
  mergeOnlyTypes?: string[];
  categoryOptions?: Record<string, string[]>;
  uniqueKeyColumns?: string[];
  fixedDropdownOptions?: Record<string, string[]>;
  onCellUpdate?: (id: string, colIndex: number, value: string) => Promise<void>;
  onFilteredRowsChange?: (rows: unknown[][]) => void;
  usdInrRate?: number | null;
  onRefreshRate?: () => void;
  onReset?: () => void;
  externalFiltersActive?: boolean;
  castingRateInputs?: {
    key: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }[];
  lockedCostIds?: ReadonlySet<string>;
  bomIdOptionsById?: Record<string, string[]>;
  onSelectBomId?: (id: string, bomId: string | null) => void;
  bomIdCategoryFilter?: boolean;
  filterState?: {
    columnFilters: Record<string, string>;
    multiFilters: Record<string, string[]>;
    dateFrom?: string;
    dateTo?: string;
    dateRanges?: Record<string, { from: string; to: string; blank?: boolean }>;
    globalSearch: string;
    currentPage: number;
    pageSize: number;
  };
  filterActions?: {
    onColumnFilter: (header: string, value: string) => void;
    onMultiFilter: (header: string, values: string[]) => void;
    onDateFrom?: (val: string) => void;
    onDateTo?: (val: string) => void;
    onDateRange?: (header: string, from: string, to: string) => void;
    onDateBlank?: (header: string, blank: boolean) => void;
    onGlobalSearch: (val: string) => void;
    onResetFilters: () => void;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
  columnOptionMeta?: Record<
    string,
    Record<string, { count: number; sumLabel: string; partyName?: string }>
  >;
  fullHeight?: boolean;
  maxHeight?: string;
  pasteErpCodes?: {
    draft: string;
    setDraft: (value: string) => void;
    onAdd: () => void;
    onPaste: (text: string) => void;
  };
  onClearMoved?: () => void;
  onImportExcel?: (file: File) => void;
  onErpCodeChange?: (id: string, code: string) => void;
  fieldOverride?: Record<string, string>;
  filterOptionsOverride?: Record<string, string[]>;
  attachmentColumn?: string;
  onUploadAttachment?: (id: string, file: File) => Promise<void>;
  onClearAttachment?: (id: string) => Promise<void>;
  attachmentAccept?: string;
  verdictColumn?: string;
  verdictsById?: Record<string, string | null | undefined>;
  onSetVerdict?: (id: string, verdict: string | null) => Promise<void>;
  columnGroups?: ColumnGroup[];
  onDeleteRow?: (id: string) => Promise<void>;
  onMatchCosts?: () => void;
  blankOnlyEditableColumns?: string[];
  dropdownRowCondition?: (header: string, row: unknown[]) => boolean;
  imageButtonColumn?: string;
  itemImagesByCode?: Record<string, ContractReviewImage[]>;
}

export default function GMDUpdateTable({
  headers,
  rows,
  ids,
  selectedIndex,
  onSelect,
  title,
  editable,
  editableColumns,
  hiddenFilters,
  hiddenColumns,
  groupByColumn,
  mergeColumns,
  mergeTypeColumn,
  mergeOnlyTypes,
  categoryOptions,
  uniqueKeyColumns,
  fixedDropdownOptions,
  onCellUpdate,
  onFilteredRowsChange,
  usdInrRate,
  onRefreshRate,
  onReset,
  externalFiltersActive,
castingRateInputs,
  lockedCostIds,
  bomIdOptionsById,
  onSelectBomId,
  bomIdCategoryFilter,
  fullHeight,
  maxHeight,
  pasteErpCodes,
  onClearMoved,
  onImportExcel,
  onErpCodeChange,
  fieldOverride,
  filterOptionsOverride,
  attachmentColumn,
  onUploadAttachment,
  onClearAttachment,
  attachmentAccept,
  verdictColumn,
  verdictsById,
  onSetVerdict,
  columnGroups,
  onDeleteRow,
  onMatchCosts,
  blankOnlyEditableColumns,
  dropdownRowCondition,
  filterState,
  filterActions,
  columnOptionMeta,
  imageButtonColumn,
  itemImagesByCode,
}: GMDUpdateTableProps) {
  const isControlled = !!filterState;

  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [localCurrentPage, setLocalCurrentPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(25);
  const [localGlobalSearch, setLocalGlobalSearch] = useState("");
  const [localColumnFilters, setLocalColumnFilters] = useState<
    Record<string, string>
  >({});
  const [localMultiFilters, setLocalMultiFilters] = useState<
    Record<string, string[]>
  >({});
  const [localDateFrom, setLocalDateFrom] = useState("");
  const [localDateTo, setLocalDateTo] = useState("");
  const [localDateRanges, setLocalDateRanges] = useState<
    Record<string, { from: string; to: string; blank?: boolean }>
  >({});

  const currentPage = isControlled
    ? filterState!.currentPage
    : localCurrentPage;
  const pageSize = isControlled ? filterState!.pageSize : localPageSize;
  const globalSearch = isControlled
    ? filterState!.globalSearch
    : localGlobalSearch;
  const columnFilters = isControlled
    ? filterState!.columnFilters
    : localColumnFilters;
  const multiFilters = isControlled
    ? filterState!.multiFilters
    : localMultiFilters;
  const dateFrom = isControlled
    ? (filterState!.dateFrom ?? "")
    : localDateFrom;
  const dateTo = isControlled ? (filterState!.dateTo ?? "") : localDateTo;
  const dateRanges = isControlled
    ? (filterState!.dateRanges ?? EMPTY_DATE_RANGES)
    : localDateRanges;
  const setDateRange = useCallback(
    (header: string, from: string, to: string) => {
      if (filterActions?.onDateRange) {
        filterActions.onDateRange(header, from, to);
      } else if (isControlled) {
        filterActions?.onDateFrom?.(from);
        filterActions?.onDateTo?.(to);
      } else {
        setLocalDateRanges((prev) => {
          const next = { ...prev };
          if (from || to) next[header] = { from, to };
          else delete next[header];
          return next;
        });
        setLocalDateFrom(from);
        setLocalDateTo(to);
      }
    },
    [filterActions, isControlled],
  );
  const setCurrentPage = isControlled
    ? filterActions!.onPageChange
    : setLocalCurrentPage;
  const setPageSize = isControlled
    ? filterActions!.onPageSizeChange
    : setLocalPageSize;
  const setDateBlank = useCallback(
    (header: string, blank: boolean) => {
      if (filterActions?.onDateBlank) {
        filterActions.onDateBlank(header, blank);
      } else {
        setLocalDateRanges((prev) => {
          const next = { ...prev };
          if (blank) next[header] = { from: "", to: "", blank: true };
          else if (next[header]) {
            const { from, to } = next[header];
            if (from || to) next[header] = { from, to };
            else delete next[header];
          }
          return next;
        });
      }
      setCurrentPage(1);
    },
    [filterActions, setCurrentPage],
  );

  const DATE_FILTER_CANDIDATES = useMemo(() => new Set(["Date", "expiryDate", "DATE OF CONTRACT", "LC DATE/RTGS DATE", "LAST DATE OF SHIPMENT/DATE OF LC"]), []);
  const dateColIdx = useMemo(() => {
    for (const cand of DATE_FILTER_CANDIDATES) {
      const idx = headers.indexOf(cand);
      if (idx !== -1) return idx;
    }
    // Fallback: any header containing "date" (e.g. future Warranty Exp Date)
    const fallback = headers.findIndex((h) => h.toLowerCase().includes("date"));
    return fallback;
  }, [headers, DATE_FILTER_CANDIDATES]);
  const isDateFilterHeader = useCallback((header: string) => DATE_FILTER_CANDIDATES.has(header), [DATE_FILTER_CANDIDATES]);
  const hiddenSet = useMemo(
    () => new Set(hiddenColumns ?? []),
    [hiddenColumns],
  );
  const groupByIdx = groupByColumn ? headers.indexOf(groupByColumn) : -1;
  const mergeTypeIdx = mergeTypeColumn ? headers.indexOf(mergeTypeColumn) : -1;
  const isMergeable = (row: unknown[]): boolean => {
    if (mergeTypeIdx === -1 || !mergeOnlyTypes || mergeOnlyTypes.length === 0) {
      return true;
    }
    return mergeOnlyTypes.includes(String(row[mergeTypeIdx] ?? "").trim());
  };
  const mergeIdxSet = useMemo(
    () =>
      new Set(
        (mergeColumns ?? [])
          .map((h) => headers.indexOf(h))
          .filter((i) => i >= 0),
      ),
    [mergeColumns, headers],
  );
  const isGrouped = groupByIdx >= 0 && mergeIdxSet.size > 0;
  // Maps every group child to its owning group so a group can be collapsed onto
  // its first *visible* child. Children in hiddenColumns are skipped, so a group
  // whose leading child is hidden still renders on its next visible child.
  const groupByChild = useMemo(() => {
    const map = new Map<string, { group: ColumnGroup; isFirst: boolean }>();
    if (!columnGroups) return map;
    for (const group of columnGroups) {
      const visibleChildren = group.children.filter(
        (c) => headers.includes(c.header) && !hiddenSet.has(c.header),
      );
      visibleChildren.forEach((child, i) => {
        if (map.has(child.header)) return;
        map.set(child.header, { group, isFirst: i === 0 });
      });
    }
    return map;
  }, [columnGroups, headers, hiddenSet]);
  const visibleCols: ResolvedCol[] = useMemo(() => {
    const out: ResolvedCol[] = [];
    headers.forEach((header, idx) => {
      if (hiddenSet.has(header)) return;
      const info = groupByChild.get(header);
      if (!info) {
        out.push({ header, idx });
        return;
      }
      // Non-first children are absorbed into the group's single column.
      if (!info.isFirst) return;
      const children = info.group.children.filter(
        (c) => headers.includes(c.header) && !hiddenSet.has(c.header),
      );
      if (children.length === 0) {
        out.push({ header, idx });
        return;
      }
      out.push({ header, idx, group: { ...info.group, children } });
    });
    return out;
  }, [headers, hiddenSet, groupByChild]);
  const dispatch = useAppDispatch();
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    () => {
      // A collapsed group seeds the width of the column it renders on, so a
      // later drag-resize behaves exactly like a standalone column.
      const groupWidthByHeader = new Map<string, number>();
      for (const g of columnGroups ?? []) {
        if (!g.width) continue;
        const anchor = g.children.find((c) => !hiddenSet.has(c.header));
        if (anchor) groupWidthByHeader.set(anchor.header, g.width);
      }
      const widths: Record<number, number> = {};
      headers.forEach((h, i) => {
        const gw = groupWidthByHeader.get(h);
        if (gw) {
          widths[i] = gw;
          return;
        }
        widths[i] =
          h === "ITEM NAME (proposed)-AUTO"
            ? 200
            : h === "Party Mail Address"
              ? 300
              : h === "ORDER LIST"
                ? 160
                : h === "Upload Diagram"
                  ? 200
                  : h === "CONTRACT NO"
                    ? 360
                    : 180;
      });
      return widths;
    },
  );
  const getColWidth = useCallback(
    (col: ResolvedCol) =>
      columnWidths[col.idx] ?? col.group?.width ?? DEFAULT_GROUP_WIDTH,
    [columnWidths],
  );
  // Left offsets for the frozen leading columns, derived from the *visible*
  // column order and real rendered widths so a collapsed group (wider than any
  // single child) cannot desync the header from the body.
  const frozenOffsets = useMemo(() => {
    const offsets: (number | undefined)[] = [];
    let acc = 0;
    const count = Math.min(FROZEN_VISIBLE_COLUMNS, visibleCols.length);
    for (let i = 0; i < count; i++) {
      offsets.push(acc);
      acc += getColWidth(visibleCols[i]);
    }
    return offsets;
  }, [visibleCols, getColWidth]);
  const resizingRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteRow = useMemo(() => {
    if (!confirmDeleteId) return null;
    const idx = ids.indexOf(confirmDeleteId);
    if (idx === -1) return null;
    return { id: confirmDeleteId, erpCode: String(rows[idx]?.[0] ?? "").trim() };
  }, [confirmDeleteId, ids, rows]);

  const handleSort = (colIndex: number) => {
    if (sortColumn === colIndex) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(colIndex);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handleColumnFilter = (header: string, value: string) => {
    if (isControlled) filterActions!.onColumnFilter(header, value);
    else setLocalColumnFilters((prev) => ({ ...prev, [header]: value }));
    setCurrentPage(1);
  };

  const handleMultiFilter = (header: string, values: string[]) => {
    if (isControlled) filterActions!.onMultiFilter(header, values);
    else
      setLocalMultiFilters((prev) => {
        const next = { ...prev };
        if (values.length) next[header] = values;
        else delete next[header];
        return next;
      });
    setCurrentPage(1);
  };
  const handleExportToExcel = async () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows = filteredWithIds.map(({ row }) => {
        const obj: Record<string, unknown> = {};
        visibleCols.forEach(({ header, idx }) => {
          const v = row[idx];
          obj[header] = v != null ? String(v) : "";
        });
        return obj;
      });
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(
        workbook,
        `${title?.replace(/\s+/g, "_") || "Export"}_${dateStr}.xlsx`,
      );
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: any) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const handleResetFilters = () => {
    if (isControlled) filterActions!.onResetFilters();
    else {
      setLocalColumnFilters({});
      setLocalMultiFilters({});
      setLocalGlobalSearch("");
      setLocalDateFrom("");
      setLocalDateTo("");
      setLocalDateRanges({});
    }
    setCurrentPage(1);
    onReset?.();
  };

  const hasActiveFilters =
    Object.values(columnFilters).some((v) => v && v !== "All") ||
    Object.values(multiFilters).some((v) => v.length > 0) ||
    globalSearch.trim() !== "" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    Object.values(dateRanges).some((r) => r.from || r.to || r.blank);

  const showResetFilters = hasActiveFilters || !!externalFiltersActive;

  const sortedWithIds = useMemo(() => {
    const decorated = rows.map((row, i) => ({ row, id: ids[i], i }));
    if (sortColumn === null && !isGrouped) return decorated;
    const dir = sortDirection === "asc" ? 1 : -1;
    const sortHeader = sortColumn !== null ? (headers[sortColumn] ?? "") : "";
    const isDateSort = sortColumn !== null && isDateHeader(sortHeader);
    decorated.sort((a, b) => {
      if (isGrouped) {
        const g = cellCompare(a.row[groupByIdx], b.row[groupByIdx], 1);
        if (g !== 0) return g;
      }
      if (sortColumn !== null) {
        const c = isDateSort
          ? compareDates(a.row[sortColumn], b.row[sortColumn], dir)
          : cellCompare(a.row[sortColumn], b.row[sortColumn], dir);
        if (c !== 0) return c;
      }
      return a.i - b.i;
    });
    return decorated;
  }, [rows, ids, sortColumn, sortDirection, isGrouped, groupByIdx, headers]);

  const rowSearchCache = useMemo(() => {
    const cache = new Map<unknown[], string>();
    for (const row of rows) {
      cache.set(
        row,
        headers.map((_, i) => String(row[i] ?? "").toLowerCase()).join(" "),
      );
    }
    return cache;
  }, [rows, headers]);

  const rowPassesFilters = useCallback(
    (row: unknown[], opts: { excludeHeader?: string; id?: string } = {}): boolean => {
      const gs = globalSearch;
      if (gs.trim()) {
        const q = gs.toLowerCase();
        if (!(rowSearchCache.get(row) ?? "").includes(q)) return false;
      }

      for (const [colName, filterVal] of Object.entries(columnFilters)) {
        if (colName === opts.excludeHeader) continue;
        if (!filterVal || filterVal === "All") continue;
        if (colName === BOM_ID_COLUMN && bomIdCategoryFilter) {
          if (!opts.id) continue;
          const cat = getBomIdCategory(bomIdOptionsById?.[opts.id]);
          if (cat !== filterVal) return false;
          continue;
        }
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const cellVal = String(row[colIdx] ?? "");
        if (
          filterVal === "(Blank)" ||
          filterVal === "-" ||
          filterVal === "—"
        ) {
          if (cellVal !== "") return false;
        } else if (!cellVal.toLowerCase().includes(filterVal.toLowerCase())) {
          return false;
        }
      }

      for (const [colName, selected] of Object.entries(multiFilters)) {
        if (colName === opts.excludeHeader) continue;
        if (!selected.length) continue;
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const cellVal = String(row[colIdx] ?? "").trim();
        const matchesBlank = selected.includes("(Blank)") && cellVal === "";
        const matchesHasValue =
          selected.includes(FLOW_HAS_VALUE) && cellHasValue(cellVal);
        const matchesNoValue =
          selected.includes(FLOW_NO_VALUE) && !cellHasValue(cellVal);
        const matchesZero = selected.includes(FLOW_ZERO) && cellIsZero(cellVal);
        const matchesNonZero =
          selected.includes(FLOW_NON_ZERO) && !cellIsZero(cellVal);
        if (
          !(
            matchesBlank ||
            matchesHasValue ||
            matchesNoValue ||
            matchesZero ||
            matchesNonZero ||
            selected.includes(cellVal)
          )
        )
          return false;
      }

      for (const [colName, r] of Object.entries(dateRanges)) {
        if (colName === opts.excludeHeader) continue;
        if (!r.from && !r.to && !r.blank) continue;
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const dateStr = String(row[colIdx] ?? "");
        if (r.blank) {
          const isBlank =
            dateStr === "" || dateStr === "-" || dateStr === "—";
          if (!isBlank) return false;
          continue;
        }
        if (!dateStr) return false;
        const date = parseDate(dateStr);
        if (!date) return false;
        const fromDate = r.from ? new Date(r.from + "T00:00:00") : null;
        const toEnd = r.to ? new Date(r.to + "T23:59:59") : null;
        if (fromDate && date < fromDate) return false;
        if (toEnd && date > toEnd) return false;
      }

      if (dateColIdx !== -1 && (dateFrom || dateTo)) {
        const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
        const toEnd = dateTo ? new Date(dateTo + "T23:59:59") : null;
        const dateStr = String(row[dateColIdx] ?? "");
        if (!dateStr) return false;
        const date = parseDate(dateStr);
        if (!date) return false;
        if (fromDate && date < fromDate) return false;
        if (toEnd && date > toEnd) return false;
      }

      return true;
    },
    [
      globalSearch,
      rowSearchCache,
      columnFilters,
      multiFilters,
      headers,
      dateRanges,
      dateColIdx,
      dateFrom,
      dateTo,
      bomIdCategoryFilter,
      bomIdOptionsById,
    ],
  );

  const filteredWithIds = useMemo(
    () => sortedWithIds.filter(({ row, id }) => rowPassesFilters(row, { id })),
    [sortedWithIds, rowPassesFilters],
  );

  const filteredRows = useMemo(
    () => filteredWithIds.map((v) => v.row),
    [filteredWithIds],
  );

  useEffect(() => {
    onFilteredRowsChange?.(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  const pbgAmountSum = useMemo(() => {
    const colIdx = headers.indexOf("PBG AMOUNT");
    if (colIdx === -1) return null;
    return filteredRows.reduce((sum, row) => {
      const cleaned = String(row[colIdx] ?? "").replace(/,/g, "");
      const num = parseFloat(cleaned);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredRows, headers]);

  const totalRecords = filteredRows.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);

  const columnUniqueVals = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const h of headers) {
      const idx = headers.indexOf(h);
      result[h] =
        filterOptionsOverride?.[h] ||
        fixedDropdownOptions?.[h] ||
        getUniqueColumnValues(idx);
    }
    return result;
  }, [headers, categoryOptions, fixedDropdownOptions, rows, filterOptionsOverride]);

  const cascadedFilterOptions = useMemo(() => {
    const result: Record<string, string[]> = {};
    if (!hasActiveFilters) {
      return columnUniqueVals;
    }
    for (const h of headers) {
      const idx = headers.indexOf(h);
      const vals = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!rowPassesFilters(row, { excludeHeader: h, id: ids[i] })) continue;
        const v = String(row[idx] ?? "");
        if (v) vals.add(v);
      }
      let list = [...vals].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      if (categoryOptions?.[h]?.length) {
        const allowed = new Set(categoryOptions[h]);
        list = list.filter((v) => allowed.has(v));
      }
      for (const s of multiFilters[h] ?? []) {
        if (s !== "(Blank)" && !list.includes(s)) list.push(s);
      }
      result[h] = list;
    }
    for (const [h, vals] of Object.entries(filterOptionsOverride ?? {})) {
      result[h] = vals;
    }
    return result;
  }, [rows, ids, headers, categoryOptions, multiFilters, hasActiveFilters, rowPassesFilters, columnUniqueVals, filterOptionsOverride]);

  const paginatedWithIds = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return filteredWithIds.slice(start, start + pageSize);
  }, [filteredWithIds, activePage, pageSize]);

  const { mergedSpans, mergedSkipped } = useMemo(() => {
    const spans = new Map<string, number>();
    const skipped = new Set<string>();
    if (!isGrouped) return { mergedSpans: spans, mergedSkipped: skipped };
    const list = paginatedWithIds;
    const n = list.length;
    for (const c of mergeIdxSet) {
      let i = 0;
      while (i < n) {
        let j = i;
        while (
          j + 1 < n &&
          isMergeable(list[j].row) &&
          isMergeable(list[j + 1].row) &&
          cellEq(list[j].row, list[j + 1].row, groupByIdx) &&
          cellEq(list[j].row, list[j + 1].row, c)
        ) {
          j++;
        }
        const len = j - i + 1;
        if (len > 1) {
          spans.set(`${i}:${c}`, len);
          for (let k = i + 1; k <= j; k++) skipped.add(`${k}:${c}`);
        }
        i = j + 1;
      }
    }
    return { mergedSpans: spans, mergedSkipped: skipped };
  }, [paginatedWithIds, isGrouped, groupByIdx, mergeIdxSet]);

  const handleResizeStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = {
        index,
        startX: e.clientX,
        startWidth: columnWidths[index],
      };
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "col-resize";
    },
    [columnWidths],
  );

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    const { index, startX, startWidth } = resizingRef.current;
    const newWidth = Math.max(60, startWidth + (e.clientX - startX));
    setColumnWidths((prev) => ({ ...prev, [index]: newWidth }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
  }, [handleResizeMove]);

  function getUniqueColumnValues(colIdx: number): string[] {
    const vals = new Set<string>();
    for (const row of rows) {
      const v = String(row[colIdx] ?? "");
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }

  const handleCellUpdate = async (
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    const entry = paginatedWithIds[rowIndex];
    const id = entry?.id;
    if (!id) return;
    const header = headers[colIndex];

    if (onCellUpdate) {
      await onCellUpdate(id, colIndex, value);
      return;
    }

    const field = fieldOverride?.[header] ?? COL_INDEX_TO_DB_FIELD[colIndex];
    if (!field) return;

    const savedValue = value || null;

    const toastId = toast.loading(`Updating ${header}...`);
    try {
      await dispatch(
        updateGMDUpdateField({ id, field, value: savedValue }),
      ).unwrap();
      toast.success(`${header} updated`, { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || err || `Failed to update ${header}`, { id: toastId });
    }

    if (header === "ERP ITEM CODE" && value && onErpCodeChange) {
      onErpCodeChange(id, value);
    }
  };

  const handleUsdCostUpdate = async (rowIndex: number, value: string) => {
    const entry = paginatedWithIds[rowIndex];
    const id = entry?.id;
    if (!id) return;
    const toastId = toast.loading("Converting USD cost...");
    try {
      await dispatch(updateGMDUsdCost({ id, usdCost: value })).unwrap();
      toast.success("USD cost converted to INR", { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || err || "Failed to update USD cost", { id: toastId });
    }
  };

  /**
   * Per-cell render metadata, derived purely from the column name + cell value.
   * Shared by the standalone <td> path and the collapsed-group <td> path so both
   * agree on editability and highlighting.
   */
  const cellMeta = (header: string, cellIdx: number, row: unknown[]) => {
    const value = row[cellIdx];
    const display = value != null ? String(value) : "";
    const isBlankCell = String(display ?? "").trim() === "";
    const isBlankOnlyColumn = !!blankOnlyEditableColumns?.includes(header);
    const baseEditable =
      !editableColumns ||
      editableColumns.includes(header) ||
      isBlankOnlyColumn;
    const isCellEditable =
      !!editable &&
      baseEditable &&
      (!isBlankOnlyColumn || isBlankCell) &&
      (!dropdownRowCondition || dropdownRowCondition(header, row));
    const isAttachmentColumn =
      !!attachmentColumn && header === attachmentColumn && !!onUploadAttachment;
    const isPnBlankDropdown =
      header === "PN RATING" &&
      !String(display).trim() &&
      (fixedDropdownOptions?.[header]?.length ?? 0) > 0;
    return { display, isCellEditable, isAttachmentColumn, isPnBlankDropdown };
  };

  /**
   * Renders the body of one column. Lifted verbatim out of the row loop so a
   * collapsed column group can render each of its children through the exact
   * same logic (DatePicker, select, attachment, status badge, links, ...).
   */
  const renderCellContent = (
    header: string,
    cellIdx: number,
    row: unknown[],
    id: string,
    idx: number,
  ): React.ReactNode => {
    const { display, isCellEditable, isAttachmentColumn } = cellMeta(
      header,
      cellIdx,
      row,
    );
    let cellContent: React.ReactNode;
    if (isAttachmentColumn) {
      const isVerdictColumn = verdictColumn === header && onSetVerdict != null;
      cellContent = (
        <AttachmentCell
          url={display}
          accept={attachmentAccept}
          onUpload={(file) => onUploadAttachment?.(id, file)}
          onClear={() => onClearAttachment?.(id)}
          verdict={isVerdictColumn ? verdictsById?.[id] : undefined}
          onSetVerdict={
            isVerdictColumn
              ? (verdict) => onSetVerdict(id, verdict)
              : undefined
          }
        />
      );
    } else if (header === "BOM ID" && onSelectBomId) {
      const options = bomIdOptionsById?.[id] ?? [];
      if (options.length === 0) {
        cellContent = (
          <span className="truncate block italic text-gray-400">
            No BOM exists
          </span>
        );
      } else if (options.length === 1) {
        cellContent = (
          <span className="truncate block" title={options[0]}>
            {display || options[0] || "—"}
          </span>
        );
      } else {
        cellContent = (
          <select
            value={display}
            onChange={(e) => onSelectBomId?.(id, e.target.value || null)}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-transparent border-none outline-none cursor-pointer"
            title={options.join(", ")}
          >
            <option value="">-- select --</option>
            {options.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        );
      }
    } else if (header === "RM AVAIL") {
      if (display === "SA") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
            SA
          </span>
        );
      } else if (display === "Not available") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
            Not available
          </span>
        );
      } else {
        cellContent = <span className="truncate block text-gray-400">—</span>;
      }
    } else if (header === "NO USE" || header === "USE/NO USE") {
      if (display === "USE") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
            USE
          </span>
        );
      } else if (display === "NO USE") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
            NO USE
          </span>
        );
      } else {
        cellContent = <span className="truncate block text-gray-400">—</span>;
      }
    } else if (isCellEditable) {
      if (header === "USD cost") {
        cellContent = (
          <input
            key={display + "-" + idx + "-" + cellIdx}
            type="text"
            defaultValue={display}
            placeholder="$"
            onBlur={(e) => {
              if (e.target.value !== display) {
                handleUsdCostUpdate(idx, e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full text-xs bg-transparent border-none outline-none font-mono-md"
          />
        );
      } else if (header === "cost") {
        if (lockedCostIds?.has(id)) {
          cellContent = (
            <span
              className="truncate block font-mono-md text-foreground"
              title={display}
            >
              {display || "—"}
            </span>
          );
        } else {
          cellContent = (
            <input
              key={display + "-" + idx + "-" + cellIdx}
              type="text"
              defaultValue={display}
              onBlur={(e) => {
                if (e.target.value !== display) {
                  handleCellUpdate(idx, cellIdx, e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full text-xs bg-transparent border-none outline-none"
            />
          );
        }
      } else if (header === "MAJOR MARKING") {
        const isYes = display === "true";
        const isNo = display === "false";
        cellContent = (
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCellUpdate(idx, cellIdx, isYes ? "" : "true");
              }}
              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                isYes
                  ? "bg-emerald-500 text-white "
                  : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCellUpdate(idx, cellIdx, isNo ? "" : "false");
              }}
              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                isNo
                  ? "bg-rose-500 text-white "
                  : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-950/50"
              }`}
            >
              No
            </button>
          </div>
        );
      } else if (isDateHeader(header)) {
        cellContent = (
          <DatePicker
            key={display + "-" + idx + "-" + cellIdx}
            value={display}
            onChange={(next) => {
              if (next !== display) {
                handleCellUpdate(idx, cellIdx, next);
              }
            }}
          />
        );
      } else if (
        STATUS_COLUMNS.has(header) ||
        categoryOptions?.[header] ||
        fixedDropdownOptions?.[header]
      ) {
        const options = (
          fixedDropdownOptions?.[header] ||
          categoryOptions?.[header] ||
          columnUniqueVals[header] ||
          []
        ).filter(Boolean) as string[];
        const showCurrent = display.trim() !== "" && !options.includes(display);
        cellContent = (
          <select
            key={display + "-" + idx + "-" + cellIdx}
            defaultValue={display}
            onChange={(e) => handleCellUpdate(idx, cellIdx, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-transparent border-none outline-none cursor-pointer"
          >
            <option value="">-</option>
            {showCurrent && <option value={display}>{display}</option>}
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      } else {
        cellContent = (
          <input
            key={display + "-" + idx + "-" + cellIdx}
            type="text"
            defaultValue={display}
            onBlur={(e) => {
              if (e.target.value !== display) {
                handleCellUpdate(idx, cellIdx, e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full text-xs bg-transparent border-none outline-none"
          />
        );
      }
    } else if (STATUS_COLUMNS.has(header)) {
      cellContent = <GMDUpdateStatusBadge value={display || null} />;
    } else if (NUMERIC_COLUMNS.has(header)) {
      cellContent = (
        <span className="font-mono-md text-right text-foreground">
          {display || "—"}
        </span>
      );
    } else if (header === "ORDER LIST") {
      if (!display) {
        cellContent = (
          <span className="truncate block text-gray-400">—</span>
        );
      } else {
        const poIdx = headers.indexOf("PARTY Order No.");
        const poAltIdx = headers.indexOf("PO NO");
        const poVal = String(row[poIdx !== -1 ? poIdx : poAltIdx] ?? "");
        cellContent = <OrderListCell display={display} poNo={poVal} />;
      }
    } else if (display && isUrl(display)) {
      // Single URL case (non-ORDER LIST columns)
      cellContent = (
        <a
          href={display}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate block underline text-blue-600 hover:text-blue-800"
          title={display}
        >
          {display}
        </a>
      );
    } else if (
      display &&
      display.includes(",") &&
      display.split(",").some((p) => isUrl(p.trim()))
    ) {
      const linksContent = renderLinksCell(display);
      cellContent = linksContent ?? (
        <span className="truncate block" title={display}>
          {display || "—"}
        </span>
      );
    } else {
      cellContent = (
        <span className="truncate block" title={display}>
          {display || "—"}
        </span>
      );
    }
    return cellContent;
  };

  if (visibleCols.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className={`flex flex-col w-full max-w-full min-w-0 bg-white border border-[#e1e6eb] rounded-lg shadow-sm ${fullHeight ? "flex-1 min-h-0 overflow-hidden h-full" : ""}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e1e6eb] bg-[#f8f9fa]">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-bold uppercase tracking-wider text-">
              {title}
            </span>
          )}
          <span className="text-xs font-semibold text-[#0a2540]/60">
            Showing {filteredRows.length} of {rows.length} records
          </span>
          {usdInrRate != null && (
            <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-white border border-[#e1e6eb] rounded px-2 py-0.5">
              1 USD = ₹{usdInrRate.toFixed(2)}
              {onRefreshRate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshRate();
                  }}
                  className="text-[#0070f3] hover:text-[#0a2540] underline"
                  title="Refresh rate"
                >
                  refresh
                </button>
              )}
            </span>
          )}
          {castingRateInputs && castingRateInputs.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-black">
              <span className="text-[10px] uppercase tracking-wider">
                Cast Rates
              </span>
              {castingRateInputs.map(({ key, label, value, onChange }) => (
                <label
                  key={key}
                  className="flex items-center gap-1 bg-white border border-[#e1e6eb] rounded px-1.5 py-0.5 cursor-text"
                >
                  <span className="text-[9px] text-black/80">{label}</span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="0"
                    className="w-14 text-[10px] bg-transparent outline-none text-black placeholder:text-[#0a2540]/70"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pasteErpCodes && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={pasteErpCodes.draft}
                onChange={(e) => {
                  e.stopPropagation();
                  pasteErpCodes.setDraft(e.target.value);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pasteErpCodes.onPaste(e.clipboardData.getData("text"));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    pasteErpCodes.onAdd();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Paste ERP item code..."
                className="w-52 px-2 py-1.5 text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] outline-none focus:border-[#0070f3] placeholder:text-[#0a2540]/30"
                title="Paste ERP item code(s) — matching rows move from Filtered Items to this table"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  pasteErpCodes.onAdd();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] hover:text-[#0a2540] px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
              >
                Add
              </button>
              {onClearMoved && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearMoved();
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-red-800 hover:text-[#0a2540] px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
                  title="Move all rows back to Filtered Items"
                >
                  <RotateCcw size={12} />
                  Clear moved
                </button>
              )}
            </div>
          )}
          {onImportExcel && (
            <div className="relative">
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportExcel(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  importFileRef.current?.click();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-[#0a2540] px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
                title="Import Excel to fill transferred rows"
              >
                <Upload size={12} />
                Import Excel
              </button>
            </div>
          )}
          {onMatchCosts && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMatchCosts();
              }}
              className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] hover:text-[#0a2540] px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
              title="Match transferred rows (full L1-L8) to New Items and apply their cost"
            >
              <FileText size={12} />
              Match & Update Costs
            </button>
          )}
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0a2540]/40"
            />
            <DebouncedSearchInput
              value={globalSearch}
              onCommit={(val) => {
                if (isControlled) filterActions!.onGlobalSearch(val);
                else setLocalGlobalSearch(val);
                setCurrentPage(1);
              }}
              placeholder="Search all columns..."
              className="w-60 pl-8 pr-7 py-1.5 text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] outline-none focus:border-[#0070f3] placeholder:text-[#0a2540]/30"
            />
            {globalSearch && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isControlled) filterActions!.onGlobalSearch("");
                  else setLocalGlobalSearch("");
                  setCurrentPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {showResetFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-xs font-semibold text-red-800 hover:text-[#0a2540] transition-colors px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
            >
              <RotateCcw size={12} />
              Reset Filters
            </button>
          )}
          <button
            type="button"
            onClick={handleExportToExcel}
            className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] hover:text-[#0a2540] transition-colors px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
          >
            <Download size={12} />
            Export Excel
          </button>
        </div>
      </div>

      {/* Scrollable Table */}
      <div
        className={`w-full min-w-0 ${
          fullHeight ? "flex-1 min-h-0 overflow-auto" : "overflow-x-auto overflow-y-auto"
        }`}
        style={fullHeight ? undefined : { maxHeight: maxHeight || "50vh" }}
      >
        {" "}
        <table
          className="w-full text-left"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {visibleCols.map((col) => (
              <col key={col.idx} style={{ width: `${getColWidth(col)}px` }} />
            ))}
            {onDeleteRow && <col style={{ width: "84px" }} />}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="bg-[#f4f6f8]">
              {visibleCols.map((col, visIdx) => {
                const { header, idx, group } = col;
                const isSorted = sortColumn === idx;
                const uniqueVals = cascadedFilterOptions[header] ?? [];
                const frozenLeft = frozenOffsets[visIdx];

                if (group) {
                  const groupChildren = group.children.map((c) => c.header);
                  const activeCount = groupChildren.filter(
                    (h) =>
                      (multiFilters[h]?.length ?? 0) > 0 ||
                      !!columnFilters[h] ||
                      !!dateRanges[h]?.from ||
                      !!dateRanges[h]?.to ||
                      !!dateRanges[h]?.blank,
                  ).length;
                  const groupIsEditable =
                    editable &&
                    groupChildren.some(
                      (h) =>
                        editableColumns?.includes(h) ||
                        blankOnlyEditableColumns?.includes(h),
                    );
                  const clearGroup = () => {
                    groupChildren.forEach((h) => {
                      handleMultiFilter(h, []);
                      handleColumnFilter(h, "");
                      if (isDateFilterHeader(h)) setDateRange(h, "", "");
                      setDateBlank(h, false);
                    });
                  };
                  return (
                    <th
                      key={idx}
                      className={`relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-2.5 py-2 text-left border-b-2 border-[#e1e6eb] border-r last:border-r-0 select-none align-top${
                        frozenLeft !== undefined ? " sticky z-20" : ""
                      }${groupIsEditable ? " bg-amber-50/50" : ""}`}
                      style={
                        frozenLeft !== undefined ? { left: frozenLeft } : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{group.label}</span>
                          {activeCount > 0 && (
                            <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700">
                              {activeCount}
                            </span>
                          )}
                        </div>
                        {activeCount > 0 && (
                          <button
                            type="button"
                            onClick={clearGroup}
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[#0a2540]/60 hover:text-red-500 transition-colors"
                            title={`Clear ${group.label} filters`}
                          >
                            <X size={10} />
                            <span>Clear</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1 mt-1.5">
                        {group.children.map((child) => {
                          const ch = child.header;
                          const childActive =
                            (multiFilters[ch]?.length ?? 0) > 0 ||
                            !!columnFilters[ch] ||
                            !!dateRanges[ch]?.from ||
                            !!dateRanges[ch]?.to ||
                            !!dateRanges[ch]?.blank;
                          return (
                            <div key={ch} className="min-w-0 flex flex-col gap-1">
                              {isDateFilterHeader(ch) ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="date"
                                    value={dateRanges[ch]?.from ?? (dateFrom || "")}
                                    onChange={(e) =>
                                      setDateRange(
                                        ch,
                                        e.target.value,
                                        dateRanges[ch]?.to ?? (dateTo || ""),
                                      )
                                    }
                                    className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                                  />
                                  <input
                                    type="date"
                                    value={dateRanges[ch]?.to ?? (dateTo || "")}
                                    onChange={(e) =>
                                      setDateRange(
                                        ch,
                                        dateRanges[ch]?.from ?? (dateFrom || ""),
                                        e.target.value,
                                      )
                                    }
                                    className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                                  />
                                </div>
                              ) : (
                                <MultiSelect
                                  options={cascadedFilterOptions[ch] ?? []}
                                  selected={multiFilters[ch] ?? []}
                                  onChange={(vals) => handleMultiFilter(ch, vals)}
                                  optionMeta={columnOptionMeta?.[ch]}
                                />
                              )}
                              <div className="flex items-center gap-1">
                                <DebouncedSearchInput
                                  value={columnFilters[ch] ?? ""}
                                  onCommit={(val) => handleColumnFilter(ch, val)}
                                  placeholder={`Search ${ch}...`}
                                />
                                {childActive && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleColumnFilter(ch, "");
                                      handleMultiFilter(ch, []);
                                      if (isDateFilterHeader(ch))
                                        setDateRange(ch, "", "");
                                      setDateBlank(ch, false);
                                    }}
                                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                                    title={`Clear ${ch} filter`}
                                  >
                                    <X size={10} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        onMouseDown={(e) => handleResizeStart(idx, e)}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 group"
                        style={{ marginRight: "-3px" }}
                      >
                        <div className="absolute top-0 -left-1 w-3.5 h-full" />
                        <div className="absolute right-0.5 top-0 w-0.5 h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] transition-colors" />
                      </div>
                    </th>
                  );
                }

                return (
                  <th
                    key={idx}
                    className={`relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-3 py-2 text-left border-b-2 border-[#e1e6eb] border-r  last:border-r-0 select-none align-top${
                      frozenLeft !== undefined ? " sticky z-20" : ""
                    }${
                      editable &&
                      (!editableColumns ||
                        editableColumns.includes(header) ||
                        blankOnlyEditableColumns?.includes(header))
                        ? " bg-amber-50/50"
                        : ""
                    }`}
                    style={
                      frozenLeft !== undefined ? { left: frozenLeft } : undefined
                    }
                  >
                    <div
                      className="flex items-center justify-between gap-1.5 cursor-pointer"
                      onClick={() => handleSort(idx)}
                    >
                      <span className="truncate">{header}</span>
                      {isSorted && (
                        <span className="shrink-0 text-[10px] text-[#0a2540]">
                          {sortDirection === "asc" ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Column filter */}
                    {!hiddenFilters?.includes(header) &&
                      !(attachmentColumn && header === attachmentColumn && onUploadAttachment) &&
                      (isDateFilterHeader(header) ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={
                                dateRanges[header]?.from ??
                                (dateFrom || "")
                              }
                              onChange={(e) =>
                                setDateRange(
                                  header,
                                  e.target.value,
                                  dateRanges[header]?.to ?? (dateTo || ""),
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                            />
                            <input
                              type="date"
                              value={
                                dateRanges[header]?.to ?? (dateTo || "")
                              }
                              onChange={(e) =>
                                setDateRange(
                                  header,
                                  dateRanges[header]?.from ??
                                    (dateFrom || ""),
                                  e.target.value,
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                            />
                          </div>
                          {header === "DATE OF CONTRACT" && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-[10px] text-[#0a2540]/70 cursor-pointer select-none"
                              title="Show only rows with no date of contract"
                            >
                              <input
                                type="checkbox"
                                checked={!!dateRanges[header]?.blank}
                                onChange={(e) =>
                                  setDateBlank(header, e.target.checked)
                                }
                                className="accent-[#0070f3]"
                              />
                              Blanks
                            </label>
                          )}
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters[header] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter(header, val)
                              }
                              placeholder={`Search ${header}...`}
                            />
                            {(columnFilters[header] ||
                              dateFrom ||
                              dateTo ||
                              dateRanges[header]?.from ||
                              dateRanges[header]?.to ||
                              dateRanges[header]?.blank) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter(header, "");
                                  setDateRange(header, "", "");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : bomIdCategoryFilter && header === "BOM ID" ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <select
                            value={columnFilters["BOM ID"] ?? "All"}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleColumnFilter("BOM ID", e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none cursor-pointer"
                            title="Filter by BOM ID availability"
                          >
                            <option value="All">All</option>
                            {BOM_ID_FILTER_VALUES.filter(
                              (v) => v !== "All",
                            ).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <MultiSelect
                            options={uniqueVals}
                            selected={multiFilters[header] ?? []}
                            onChange={(vals) => handleMultiFilter(header, vals)}
                            optionMeta={columnOptionMeta?.[header]}
                          />
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters[header] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter(header, val)
                              }
                              placeholder={`Search ${header}...`}
                            />
                            {columnFilters[header] && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter(header, "");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    {header === "PBG AMOUNT" && pbgAmountSum !== null && (
                      <div className="mt-1 text-[11px] font-semibold text-blue-700">
                        Total :  {"  "}
                        {pbgAmountSum.toLocaleString("en-IN", {
                          maximumFractionDigits: 1,
                        })}
                      </div>
                    )}
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(idx, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 group"
                      style={{ marginRight: "-3px" }}
                    >
                      <div className="absolute top-0 -left-1 w-3.5 h-full" />
                      <div className="absolute right-0.5 top-0 w-0.5 h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] transition-colors" />
                    </div>
                  </th>
                );
              })}
              {onDeleteRow && (
                <th className="relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-3 py-2 text-center border-b-2 border-[#e1e6eb] select-none align-top">
                  Delete
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedWithIds.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleCols.length + (onDeleteRow ? 1 : 0)}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No matching rows
                </td>
              </tr>
            ) : (
              paginatedWithIds.map(({ row, id }, idx) => (
                <tr
                  key={id ?? idx}
                  className={`transition-colors hover:bg-gray-50 cursor-pointer ${
                    selectedIndex === idx ? "bg-blue-50" : ""
                  }`}
                  onClick={() => onSelect(idx)}
                >
                  {visibleCols.map((col, visIdx) => {
                    const { header, idx: cellIdx, group } = col;

                    const mergedKey = `${idx}:${cellIdx}`;
                    const isMergedCell =
                      isGrouped && mergeIdxSet.has(cellIdx);
                    if (isMergedCell && mergedSkipped.has(mergedKey)) {
                      return null;
                    }
                    const mergedSpan = isMergedCell
                      ? (mergedSpans.get(mergedKey) ?? undefined)
                      : undefined;

                    const groupIsEditable = group
                      ? group.children.some((c) => {
                          const { isCellEditable: cEditable } = cellMeta(
                            c.header,
                            headers.indexOf(c.header),
                            row,
                          );
                          return cEditable;
                        })
                      : false;
                    const { isCellEditable, isPnBlankDropdown } = cellMeta(
                      header,
                      cellIdx,
                      row,
                    );

                    const cellContent: React.ReactNode = group ? (
                      <div className="flex flex-col gap-1">
                        {group.children.map((child) => {
                          const childIdx = headers.indexOf(child.header);
                          if (childIdx === -1) return null;
                          return (
                            <div
                              key={child.header}
                              title={child.header}
                              className="flex items-center gap-1 min-w-0 rounded border border-[#e1e6eb] bg-white px-1.5 py-0.5 hover:border-[#c9d2da] transition-colors"
                            >
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[#0a2540]/55">
                                {child.label ?? child.header}
                              </span>
                              <span className="flex-1 min-w-0 text-xs text-[#0a2540]">
                                {renderCellContent(
                                  child.header,
                                  childIdx,
                                  row,
                                  id,
                                  idx,
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      renderCellContent(header, cellIdx, row, id, idx)
                    );

                    const frozenLeft = frozenOffsets[visIdx];

                    return (
                      <td
                        key={cellIdx}
                        rowSpan={mergedSpan}
                        className={`${group ? "px-2" : "px-3"} py-2 text-xs border-b border-[#e1e6eb] border-r  last:border-r-0${
                          frozenLeft !== undefined ? " sticky z-10 bg-white" : ""
                        }${
                          isCellEditable || isPnBlankDropdown || groupIsEditable
                            ? " bg-amber-50"
                            : ""
                        }`}
                        style={
                          frozenLeft !== undefined ? { left: frozenLeft } : undefined
                        }
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                  {onDeleteRow && (
                    <td className="px-2 py-2 text-xs border-b border-[#e1e6eb] text-center bg-white">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(id);
                        }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
                        title="Delete row"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        total={totalRecords}
        currentPage={activePage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />
      {onDeleteRow && (
        <Dialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
          <DialogContent className="sm:max-w-105 p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-4 pt-4 pb-3 border-b border-[#e1e6eb] bg-[#f8f9fa]">
              <DialogTitle className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
                <Trash2 size={16} className="text-rose-600" />
                Delete transferred row?
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {confirmDeleteRow?.erpCode
                  ? `ERP ${confirmDeleteRow.erpCode} — this will permanently remove the row and its S3 attachment (if any).`
                  : "This will permanently remove the row and its S3 attachment (if any)."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={async () => {
                  if (!confirmDeleteId) return;
                  const targetId = confirmDeleteId;
                  setConfirmDeleteId(null);
                  await onDeleteRow(targetId);
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}



