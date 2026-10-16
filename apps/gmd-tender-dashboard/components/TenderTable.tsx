"use client";
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  EpcTenderRecord,
  ManagementDecision,
  EMDExchangeMode,
  CURRENT_STATUS_OPTIONS,
} from "@/types/tender";
import { AttachmentModal } from "./AttachmentModal";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import type { AppDispatch } from "@/lib/store";
import { updateTenderDocketNo, updateTenderBgNoUtrNo, updateTenderRemarks, updateTenderBeneficiaryBankDetails, updateTenderReason, updateTenderLoiPoNoAndDate, updateTenderCompetitors, updateTenderCell, updateTenderStatusAndAction, updateTenderMergedField, updateWebsiteMapping, uploadTenderDocument, triggerReverseAuctionWebhook } from "@/lib/slices/tendersSlice";
import { toast } from "sonner";
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  BarChart3,
  FileSpreadsheet,
  Download,
  Paperclip,
  FileText,
  Pencil,
  Check,
  Circle,
  AlertTriangle,
  Loader2,
  RotateCcw,
  CalendarIcon,
  Eye,
  Columns3,
  CheckCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import {
  getISTWeekRange,
  getISTMonthRange,
  getISTYearRange,
} from "@/lib/format-ist";
import type { DateRange } from "react-day-picker";
import type { ReverseAuctionWebhookData } from "@/lib/integrations/n8n";
import MergedOfficeEditDialog from "./MergedOfficeEditDialog";
import WebsiteEditDialog from "./tender-viewer/website-edit-dialog";
import ReportingOfficersEditDialog from "./ReportingOfficersEditDialog";
import TenderDocumentUploadDialog from "./tender-viewer/tender-document-upload-dialog";
import TenderDetailSheet from "./TenderDetailSheet";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { countRawMaterials } from "@/lib/rawMaterials";
import { parseDate } from "@/lib/parse-date";
import { normalizeDocketKey } from "@/lib/docket";
import { formatDateISTShort, formatDateTimeIST, toISTDateKey, isBeforeTodayIST } from "@/lib/format-ist";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "./TenderTable.css";

const formatMoney = (v: unknown): string => {
  if (v == null || v === "") return "-";
  const s = String(v).trim();
  if (s === "-" || s.toLowerCase() === "null") return "-";
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (isNaN(n)) return s;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

// Static filter metadata. Hoisted to module scope so it keeps a stable identity
// across renders and can be used safely in useMemo dependency arrays.
const BOOLEAN_COLUMNS = new Set(["participated", "reverseAuctionApplicable"]);
const SKIP_FILTER_COLUMNS = new Set([
  "lastDateOfSubmission", "attachmentUrl", "files", "boqChart",
  "rawMaterials",
  "proposedErpItemName", "remarks", "tenderUpdateStatus", "nextAction",
  "itemCategory", "publishedDate", "assignedDate", "itemSchedules",
  "reverseAuctionStartDate",
]);

const TENDER_UPDATE_STATUS_FILTER_OPTIONS: Array<[string, string]> = [
  ["OPEN", "Open"],
  ["CLOSED", "Closed"],
];
const NEXT_ACTION_FILTER_OPTIONS: Array<[string, string]> = [
  ["UPDATE_FROM_AB_LETTER", "Update from AB letter"],
  ["BG_REFUND_LETTER_TO_BE_SENT", "BG refund letter to be sent"],
  ["FOLLOW_UP_FOR_FINANCIAL_STATUS", "Follow up for financial status"],
  ["REVERSE_AUCTION_PENDING", "Reverse auction pending"],
  ["COUNTER_OFFER_YES", "Counter Offer Yes"],
  ["COUNTER_OFFER_NO", "Counter Offer No"],
  ["BID_VALIDITY_NOT_ACCEPTED", "Bid Validity Not Accepted"],
];

const filesCache = new Map<string, any[]>();
const filesPromiseCache = new Map<string, Promise<any[]>>();

const fetchDocketFiles = (docketNo: string): Promise<any[]> => {
  if (filesCache.has(docketNo)) {
    // console.log(`[DEBUG fetchDocketFiles] CACHE HIT for ${docketNo}:`, filesCache.get(docketNo));
    return Promise.resolve(filesCache.get(docketNo)!);
  }
  if (filesPromiseCache.has(docketNo)) {
    // console.log(`[DEBUG fetchDocketFiles] IN-FLIGHT HIT for ${docketNo}`);
    return filesPromiseCache.get(docketNo)!;
  }
  // console.log(`[DEBUG fetchDocketFiles] FETCHING for ${docketNo}`);
  const promise = fetch(`/api/executive-tenders/${docketNo}/files`, {
    headers: {
      Authorization: "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE",
    },
  })
    .then((res) => {
      // console.log(`[DEBUG fetchDocketFiles] ${docketNo} response status:`, res.status, res.statusText);
      return res.ok ? res.json() : { files: [] };
    })
    .then((data) => {
      // console.log(`[DEBUG fetchDocketFiles] ${docketNo} response data:`, JSON.stringify(data).slice(0, 500));
      const files = data.files || [];
      filesCache.set(docketNo, files);
      filesPromiseCache.delete(docketNo);
      return files;
    })
    .catch((err) => {
      // console.warn(`[DEBUG fetchDocketFiles] ${docketNo} fetch error:`, err);
      return [];
    });
  filesPromiseCache.set(docketNo, promise);
  return promise;
};

const matchesErpItemCategory = (
  itemName: string | undefined | null,
  category: string,
): boolean => {
  if (!itemName) return false;
  const lowerName = itemName.toLowerCase();
  const lowerCategory = category.toLowerCase();

  if (lowerCategory === "ab cable") {
    return lowerName.includes("ab cable") || lowerName.includes("ab cables");
  }
  if (lowerCategory === "conductor") {
    return (
      lowerName.includes("conductor") ||
      lowerName.includes("acsr") ||
      lowerName.includes("aaac") ||
      lowerName.includes("a.c.s.r.")
    );
  }
  if (lowerCategory === "xlpe cable") {
    return (
      lowerName.includes("xlpe") &&
      !lowerName.includes("ab cable") &&
      !lowerName.includes("ab cables")
    );
  }
  if (lowerCategory === "pvc cable") {
    return lowerName.includes("pvc");
  }
  if (lowerCategory === "control cable") {
    return (
      lowerName.includes("control") || lowerName.includes("instrumentation")
    );
  }
  return false;
};

const parseListValue = (raw: string | undefined | null): string => {
  if (raw == null || raw === "") return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).join(" | ");
  } catch {}
  return String(raw);
};

const FilesCell: React.FC<{
  tenderFilesJson: string;
  onOpenModal: (files: any[]) => void;
}> = ({ tenderFilesJson, onOpenModal }) => {
  let files: any[] = [];
  try {
    files = JSON.parse(tenderFilesJson || "[]");
  } catch {}

  if (files.length === 0) return null;

  return (
    <button
      className="table-attachment-btn"
      onClick={() => onOpenModal(files)}
      title="View files"
      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
    >
      <Paperclip size={14} /> {files.length}{" "}
      {files.length === 1 ? "File" : "Files"}
    </button>
  );
};

const BOQChartCell: React.FC<{
  docketNo: string;
  boqFileId?: string | null;
  tenderFilesJson?: string;
}> = ({ docketNo, boqFileId, tenderFilesJson }) => {
  const [boqFile, setBoqFile] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const tenderFilesSource = useMemo(() => {
    if (!tenderFilesJson) return null;
    try {
      const files = JSON.parse(tenderFilesJson);
      const boqFileEntry = files.find(
        (f: any) => f.tags?.includes("boqComparativeChart"),
      );
      return boqFileEntry?.source || null;
    } catch {
      return null;
    }
  }, [tenderFilesJson]);

  useEffect(() => {
    if (boqFileId || tenderFilesSource) return;
    if (!docketNo || docketNo === "-") return;

    let isMounted = true;
    setLoading(true);
    fetchDocketFiles(docketNo).then((files) => {
      if (isMounted) {
        const match = files.find((f) => {
          const lower = f.filename.toLowerCase();
          return (
            lower.includes("boqcomparativechart") ||
            lower.includes("boq_comparative") ||
            lower.includes("boq comparative")
          );
        });
        setBoqFile(match || null);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [docketNo, boqFileId, tenderFilesSource]);

  if (loading) return null;

  const effectiveFileId = boqFileId || tenderFilesSource || boqFile?.fileId;
  if (!effectiveFileId) return null;

  const handleDownload = () => {
    const token = "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE";
    window.open(
      `/api/executive-files/download/${effectiveFileId}?auth=${encodeURIComponent(token)}`,
      "_blank",
    );
  };

  return (
    <button
      className="table-boq-btn"
      onClick={handleDownload}
      title={`Download Comparative Chart`}
      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
    >
      <BarChart3 size={14} /> Comparative Chart
    </button>
  );
};

const getRaCostingFile = (tenderFilesJson?: string) => {
  if (!tenderFilesJson) return null;
  try {
    const files: Array<{ name?: string; url?: string; source?: string; tags?: string[]; extension?: string }> = JSON.parse(tenderFilesJson);
    return files.find((f) => f.tags?.includes(TENDER_FILE_TYPES.RA_COSTING_SHEET)) ?? null;
  } catch { return null; }
};

const buildRaCostingHref = (raFile: { source?: string; url?: string } | null): string => {
  if (!raFile) return "";
  const token = "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE";
  if (raFile.source && raFile.source !== "SHEET_SYNC") {
    return `/api/executive-files/view/${raFile.source}?auth=${encodeURIComponent(token)}`;
  }
  return raFile.url ?? "";
};

type EditableInputKind = "text" | "textarea" | "number";

interface EditableFieldConfig {
  accessor: string;
  kind: EditableInputKind;
  editableClass: string;
  readOnlyClass?: string;
  canEdit: (
    record: EpcTenderRecord,
    readOnly: boolean,
    editableColumns: string[],
  ) => boolean;
  display: (record: EpcTenderRecord) => string;
  toDraft: (record: EpcTenderRecord) => string;
  displayClass?: (record: EpcTenderRecord) => string;
  parse?: (draft: string) => { error?: string };
  toStored: (draft: string) => unknown;
  fromStored: (record: EpcTenderRecord) => unknown;
  save: (
    dispatch: AppDispatch,
    record: EpcTenderRecord,
    stored: unknown,
    draft: string,
  ) => Promise<unknown>;
  successMessage?: (record: EpcTenderRecord, draft: string) => string;
}

const textFieldConfig = (
  accessor: string,
  kind: EditableInputKind,
  editableClass: string,
  readOnlyClass?: string,
  canEdit?: (
    record: EpcTenderRecord,
    readOnly: boolean,
    editableColumns: string[],
  ) => boolean,
  save?: (
    dispatch: AppDispatch,
    record: EpcTenderRecord,
    stored: unknown,
    draft: string,
  ) => Promise<unknown>,
  successMessage?: (record: EpcTenderRecord, draft: string) => string,
  parse?: (draft: string) => { error?: string },
): EditableFieldConfig => ({
  accessor,
  kind,
  editableClass,
  readOnlyClass,
  canEdit: canEdit ?? (() => true),
  display: (record) => {
    const v = record[accessor as keyof EpcTenderRecord];
    return v !== null && v !== undefined && v !== "" ? String(v) : "-";
  },
  toDraft: (record) => {
    const v = record[accessor as keyof EpcTenderRecord];
    return v !== null && v !== undefined ? String(v) : "";
  },
  parse,
  toStored: (draft) => draft.trim(),
  fromStored: (record) =>
    String(record[accessor as keyof EpcTenderRecord] ?? ""),
  save:
    save ??
    ((dispatch, record, stored) =>
      dispatch(
        updateTenderMergedField({
          rowIndex: 0,
          field: accessor,
          value: stored as string,
          tenderMergedId: Number(record.id),
          oldValue: String(record[accessor as keyof EpcTenderRecord] ?? ""),
        }),
      ).unwrap()),
  successMessage:
    successMessage ?? (() => `${accessor} updated successfully!`),
});

const EDITABLE_FIELDS: Record<string, EditableFieldConfig> = {
  docketNo: textFieldConfig(
    "docketNo",
    "text",
    "col-docket col-editable",
    "col-docket",
    (r, readOnly) => !readOnly || !r.docketNo,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderDocketNo({
          tenderMergedId: Number(record.id),
          docketNo: stored as string,
          oldDocketNo: record.docketNo ?? "",
        }),
      ).unwrap(),
    (_, draft) => `Docket ${draft.trim()} updated successfully!`,
    (draft) => {
      const v = draft.trim();
      if (v && !/^ENQ-\d+-(?:(\d{4})-\1|\d{2}-\d{2})$/i.test(v)) {
        return {
          error:
            'Docket No must match format ENQ-{number}-{year}-{year} (e.g., ENQ-12345-2025-2026 or ENQ-12345-2026-2026).',
        };
      }
      return {};
    },
  ),
  bgNoUtrNo: textFieldConfig(
    "bgNoUtrNo",
    "text",
    "col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderBgNoUtrNo({
          tenderMergedId: Number(record.id),
          bgNoUtrNo: stored as string,
          oldBgNoUtrNo: record.bgNoUtrNo ?? "",
        }),
      ).unwrap(),
    () => "BG/UTR No updated successfully!",
  ),
  remarks: textFieldConfig(
    "remarks",
    "textarea",
    "col-left col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderRemarks({
          tenderMergedId: Number(record.id),
          remarks: stored as string,
          oldRemarks: record.remarks ?? "",
        }),
      ).unwrap(),
    () => "Remarks updated successfully!",
  ),
  beneficiaryBankDetails: textFieldConfig(
    "beneficiaryBankDetails",
    "text",
    "col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderBeneficiaryBankDetails({
          tenderMergedId: Number(record.id),
          beneficiaryBankDetails: stored as string,
          oldBeneficiaryBankDetails: record.beneficiaryBankDetails ?? "",
        }),
      ).unwrap(),
    () => "Bank details updated!",
  ),
  loiPoNoAndDate: textFieldConfig(
    "loiPoNoAndDate",
    "text",
    "col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderLoiPoNoAndDate({
          tenderMergedId: Number(record.id),
          loiPoNoAndDate: stored as string,
          oldLoiPoNoAndDate: record.loiPoNoAndDate ?? "",
        }),
      ).unwrap(),
    () => "LOI/PO No updated!",
  ),
  competitors: textFieldConfig(
    "competitors",
    "textarea",
    "col-left col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderCompetitors({
          tenderMergedId: Number(record.id),
          competitors: stored as string,
          oldCompetitors: record.competitors ?? "",
        }),
      ).unwrap(),
    () => "Competitors updated!",
  ),
  reason: textFieldConfig(
    "reason",
    "textarea",
    "col-left col-editable",
    undefined,
    undefined,
    (dispatch, record, stored) =>
      dispatch(
        updateTenderReason({
          tenderMergedId: Number(record.id),
          reason: stored as string,
          oldReason: record.reason ?? "",
        }),
      ).unwrap(),
    () => "Reason updated!",
  ),
  miiPurchasePreference: textFieldConfig("miiPurchasePreference", "text", "col-editable"),
  raQualificationRule: textFieldConfig("raQualificationRule", "text", "col-editable"),
  startupExemption: textFieldConfig("startupExemption", "text", "col-editable"),
  minimumAverageAnnualTurnover: textFieldConfig(
    "minimumAverageAnnualTurnover",
    "text",
    "col-editable",
  ),
  yearsOfPastExperience: textFieldConfig("yearsOfPastExperience", "text", "col-editable"),
  ePbgDurationMonths: textFieldConfig("ePbgDurationMonths", "text", "col-editable"),
  // verbatim tender_merged fields — separate columns
  documentFees: textFieldConfig("documentFees", "text", "col-editable"),
  contractPeriod: textFieldConfig("contractPeriod", "text", "col-editable"),
  bidOfferValidity: textFieldConfig("bidOfferValidity", "text", "col-editable"),
  location: textFieldConfig("location", "text", "col-editable"),
  documentRequiredFromSeller: textFieldConfig("documentRequiredFromSeller", "text", "col-editable"),
  pastPerformance: textFieldConfig("pastPerformance", "text", "col-editable"),
  typeOfBid: textFieldConfig("typeOfBid", "text", "col-editable"),
  technicalClarificationTimeAllowed: textFieldConfig("technicalClarificationTimeAllowed", "text", "col-editable"),
  mediationClause: textFieldConfig("mediationClause", "text", "col-editable"),
  arbitrationClause: textFieldConfig("arbitrationClause", "text", "col-editable"),
  oemAverageTurnover: textFieldConfig("oemAverageTurnover", "text", "col-editable"),
  ePbgPercentage: textFieldConfig("ePbgPercentage", "text", "col-editable"),
  msmeExemption: textFieldConfig("msmeExemption", "text", "col-editable"),
  msePurchasePreference: textFieldConfig("msePurchasePreference", "text", "col-editable"),
  expectedRaDate: textFieldConfig(
    "expectedRaDate",
    "text",
    "col-center col-editable",
    "col-center",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("expectedRaDate")),
  ),
  ourRank: textFieldConfig(
    "ourRank",
    "text",
    "col-center col-editable",
    "col-center",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("ourRank")),
  ),
  ourValue: textFieldConfig(
    "ourValue",
    "text",
    "col-center col-editable",
    "col-center",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("ourValue")),
  ),
  nameOfRank1: textFieldConfig(
    "nameOfRank1",
    "text",
    "col-left col-editable",
    "col-left",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("nameOfRank1")),
  ),
  valueOfRank1: textFieldConfig(
    "valueOfRank1",
    "text",
    "col-right col-editable",
    "col-right",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("valueOfRank1")),
  ),
  differenceBetweenRank1: textFieldConfig(
    "differenceBetweenRank1",
    "text",
    "col-right diff-col",
    "col-right diff-col",
    () => false,
  ),
  nameOfRank2: textFieldConfig(
    "nameOfRank2",
    "text",
    "col-left col-editable",
    "col-left",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("nameOfRank2")),
  ),
  valueOfRank2: textFieldConfig(
    "valueOfRank2",
    "text",
    "col-right col-editable",
    "col-right",
    (r, readOnly, editableColumns) => !(readOnly && !editableColumns.includes("valueOfRank2")),
  ),
  differenceBetweenRank2: textFieldConfig(
    "differenceBetweenRank2",
    "text",
    "col-right diff-col",
    "col-right diff-col",
    () => false,
  ),
  quotationNo: textFieldConfig(
    "quotationNo",
    "text",
    "col-docket col-editable",
    "col-docket",
    (r, readOnly) => !readOnly || !r.quotationNo,
  ),
  contractNo: textFieldConfig(
    "contractNo",
    "text",
    "col-docket col-editable",
    "col-docket",
    (r, readOnly) => !readOnly || !r.contractNo,
  ),
  emd: textFieldConfig("emd", "text", "col-editable"),
  bgDate: textFieldConfig("bgDate", "text", "col-editable"),
  bgExpiryDate: textFieldConfig("bgExpiryDate", "text", "col-editable"),
  claimDate: textFieldConfig("claimDate", "text", "col-editable"),
  typetest: textFieldConfig("typetest", "text", "col-left col-editable", "col-left"),
};

const InlineEditor: React.FC<{
  initialValue: string;
  kind: EditableInputKind;
  saving: boolean;
  onSave: (draft: string) => void;
  onCancel: () => void;
}> = ({ initialValue, kind, saving, onSave, onCancel }) => {
  const [draft, setDraft] = useState(initialValue);
  const editorRef = useRef<HTMLDivElement>(null);
  const commit = () => {
    if (!saving) onSave(draft);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (saving) return;
      if (editorRef.current && !editorRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () =>
      document.removeEventListener("mousedown", handleOutsideClick);
  }, [onCancel, saving]);

  if (kind === "textarea") {
    return (
      <div
        ref={editorRef}
        style={{ display: "inline-flex", alignItems: "flex-start", gap: 4 }}
        onContextMenu={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          autoFocus
          disabled={saving}
          className="remarks-edit-textarea"
          rows={3}
          style={{ width: "100%", minWidth: 180, fontSize: 11, padding: "4px 6px", resize: "vertical" }}
        />
        <button
          onClick={commit}
          disabled={saving}
          className="docket-save-btn"
          title="Save"
          style={{ flexShrink: 0, marginTop: 2 }}
        >
          <Check size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={editorRef}
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      onContextMenu={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        type={kind === "number" ? "number" : "text"}
        step={kind === "number" ? "any" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        autoFocus
        disabled={saving}
        className="docket-edit-input"
        placeholder={kind === "number" ? "e.g. -6.5" : undefined}
      />
      <button onClick={commit} disabled={saving} className="docket-save-btn" title="Save">
        <Check size={14} />
      </button>
    </div>
  );
};

const RaDateInput: React.FC<{
  initialValue: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}> = ({ initialValue, disabled, onCommit }) => {
  const [draft, setDraft] = useState(initialValue);
  const committedRef = useRef(false);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value.trim());
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="text"
        value={draft}
        disabled={disabled}
        placeholder="dd-mm-yyyy hh:mm"
        onChange={(e) => {
          committedRef.current = false;
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Escape") {
            setDraft(initialValue);
            committedRef.current = false;
          }
        }}
        style={{
          fontSize: "11px",
          padding: "2px 4px",
          border: "1px solid #dadce0",
          borderRadius: "4px",
          width: "100%",
          maxWidth: 112,
          background: "#fff",
          color: "#202124",
        }}
      />
      <button
        type="button"
        className="docket-save-btn"
        title="Save"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit(draft)}
      >
        <Check size={14} />
      </button>
    </div>
  );
};

interface TenderTableProps {
  records: EpcTenderRecord[];
  priceBasisFilter?: string;
  setPriceBasisFilter?: (val: string) => void;
  aluminiumMin?: string;
  setAluminiumMin?: (val: string) => void;
  aluminiumMax?: string;
  setAluminiumMax?: (val: string) => void;
  copperMin?: string;
  setCopperMin?: (val: string) => void;
  copperMax?: string;
  setCopperMax?: (val: string) => void;
  clearTrigger?: number;
  readOnly?: boolean;
  showPostParticipationColumns?: boolean;
  editableColumns?: string[];
  defaultEndDate?: string;
  showDeadlineOverBadge?: boolean;
  showReasonColumn?: boolean;
  showTypeTestColumn?: boolean;
  variant?: "epc" | "party";
}

interface ColumnDef {
  header: string;
  accessor: keyof EpcTenderRecord | "rawMaterials" | "files" | "boqChart" | "merged_office_consignees" | "tenderDocument" | "itemSchedules";
  defaultWidth: number;
  align: "left" | "right" | "center";
  sticky?: boolean;
  type:
    | "string"
    | "number"
    | "date"
    | "boolean"
    | "percentage"
    | "currency"
    | "status"
    | "decision"
    | "custom";
}

export const TenderTable: React.FC<TenderTableProps> = ({
  records,
  priceBasisFilter,
  setPriceBasisFilter,
  aluminiumMin,
  setAluminiumMin,
  aluminiumMax,
  setAluminiumMax,
  copperMin,
  setCopperMin,
  copperMax,
  setCopperMax,
  clearTrigger,
  readOnly = false,
  showPostParticipationColumns = false,
  editableColumns = [],
  defaultEndDate,
  showDeadlineOverBadge = false,
  showReasonColumn = false,
  showTypeTestColumn = false,
  variant = "epc",
}) => {
  // 1. Column Definitions
  const columns: ColumnDef[] = [
    {
      header: "Docket No",
      accessor: "docketNo",
      defaultWidth: 180,
      align: "left",
      type: "string",
      sticky: true,
    },
    {
      header: "Tender Type",
      accessor: "tenderType",
      defaultWidth: 180,
      align: "left",
      type: "string",
      sticky: true,
    },
    {
      header: "Tender / NIT No",
      accessor: "tenderNoNitNo",
      defaultWidth: 180,
      align: "left",
      type: "string",
      sticky: true,
    },
    {
      header: "Last Date of Submission",
      accessor: "lastDateOfSubmission",
      defaultWidth: 200,
      align: "center",
      type: "date",
    },
    {
      header: "Published Date",
      accessor: "publishedDate",
      defaultWidth: 180,
      align: "center",
      type: "date",
    },
    {
      header: "Assigned Date",
      accessor: "assignedDate",
      defaultWidth: 180,
      align: "center",
      type: "date",
    },
    {
      header: "Client Name",
      accessor: "nameOfTheClient",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "Tender Brief",
      accessor: "tenderBrief",
      defaultWidth: 250,
      align: "left",
      type: "string",
    },
    {
      header: "Item Schedule",
      accessor: "itemSchedules",
      defaultWidth: 220,
      align: "left",
      type: "custom",
    },
    {
      header: "Proposed ERP Item Name",
      accessor: "proposedErpItemName",
      defaultWidth: 250,
      align: "left",
      type: "custom",
    },
    {
      header: "Proposed ERP Quantity",
      accessor: "proposedErpQuantity",
      defaultWidth: 280,
      align: "left",
      type: "custom",
    },
    {
      header: "Type Test",
      accessor: "typeTests" as unknown as ColumnDef["accessor"],
      defaultWidth: 260,
      align: "left",
      type: "custom",
    },
    {
      header: "Costing File",
      accessor: "attachmentUrl",
      defaultWidth: 180,
      align: "center",
      type: "custom",
    },
    {
      header: "Files",
      accessor: "files",
      defaultWidth: 180,
      align: "center",
      type: "custom",
    },
    {
      header: "Comparative Chart",
      accessor: "boqChart",
      defaultWidth: 180,
      align: "center",
      type: "custom",
    },
    {
      header: "Price",
      accessor: "price",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "Applicable Index",
      accessor: "applicableIndex",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Raw Materials",
      accessor: "rawMaterials",
      defaultWidth: 220,
      align: "center",
      type: "custom",
    },
    {
      header: "EMD Payment Mode",
      accessor: "emdPaymentMode",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "emd",
      accessor: "emd",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "bgDate",
      accessor: "bgDate",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "bgExpiryDate",
      accessor: "bgExpiryDate",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "claimDate",
      accessor: "claimDate",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "BG / UTR No",
      accessor: "bgNoUtrNo",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "BG Status",
      accessor: "bgStatus",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "Beneficiary Bank Details",
      accessor: "beneficiaryBankDetails",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Issuing Bank",
      accessor: "issuingBank",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Current Status",
      accessor: "currentStatus",
      defaultWidth: 180,
      align: "center",
      type: "status",
    },
    {
      header: "Status Category",
      accessor: "statusCategory",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "Reason for not Participated",
      accessor: "reason",
      defaultWidth: 250,
      align: "left",
      type: "string",
    },
    {
      header: "RA",
      accessor: "reverseAuctionApplicable",
      defaultWidth: 180,
      align: "center",
      type: "boolean",
    },
    {
      header: "RA Dates",
      accessor: "reverseAuctionStartDate",
      defaultWidth: 200,
      align: "center",
      type: "custom",
    },
    {
      header: "Expected RA Date",
      accessor: "expectedRaDate",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "LOI / PO No.",
      accessor: "loiPoNoAndDate",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Quotation No",
      accessor: "quotationNo",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Contract Number",
      accessor: "contractNo",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Competitors",
      accessor: "competitors",
      defaultWidth: 250,
      align: "left",
      type: "custom",
    },
    {
      header: "Our Rank",
      accessor: "ourRank",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "Our Value",
      accessor: "ourValue",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "L1 Party Name",
      accessor: "nameOfRank1",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "L1 Price",
      accessor: "valueOfRank1",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "L1 Diff (%)",
      accessor: "differenceBetweenRank1",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "L2 Party Name",
      accessor: "nameOfRank2",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "L2 Price",
      accessor: "valueOfRank2",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "L2 Diff (%)",
      accessor: "differenceBetweenRank2",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "Tender Update Status",
      accessor: "tenderUpdateStatus",
      defaultWidth: 180,
      align: "center",
      type: "custom",
    },
    {
      header: "Next Action",
      accessor: "nextAction",
      defaultWidth: 220,
      align: "left",
      type: "custom",
    },
    {
      header: "Remarks",
      accessor: "remarks",
      defaultWidth: 250,
      align: "left",
      type: "string",
    },
    {
      header: "CVA",
      accessor: "cva",
      defaultWidth: 180,
      align: "center",
      type: "string",
    },
    {
      header: "Mgmt Dec.",
      accessor: "managementDecision",
      defaultWidth: 180,
      align: "center",
      type: "decision",
    },
    {
      header: "Catalogue Done",
      accessor: "catalogueDone",
      defaultWidth: 120,
      align: "center",
      type: "custom",
    },
    {
      header: "Prep By",
      accessor: "tenderPrepareBy",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Participated?",
      accessor: "participated",
      defaultWidth: 180,
      align: "center",
      type: "boolean",
    },
    // --- New Columns ---
    {
      header: "Office Name @ Consignees Reporting Officer",
      accessor: "merged_office_consignees",
      defaultWidth: 220,
      align: "left",
      type: "custom",
    },
    {
      header: "Mii Purchase Preference",
      accessor: "miiPurchasePreference",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Tender Document",
      accessor: "tenderDocument",
      defaultWidth: 200,
      align: "center",
      type: "custom",
    },
    {
      header: "Reporting Officers",
      accessor: "reportings",
      defaultWidth: 500,
      align: "left",
      type: "custom",
    },
    {
      header: "Website",
      accessor: "website",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "RA Qualification Rule",
      accessor: "raQualificationRule",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "Startup Exemption",
      accessor: "startupExemption",
      defaultWidth: 180,
      align: "center",
      type: "custom",
    },
    {
      header: "Minimum Avg Annual Turnover",
      accessor: "minimumAverageAnnualTurnover",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "Years of Past Experience",
      accessor: "yearsOfPastExperience",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "e-PBG Duration (Months)",
      accessor: "ePbgDurationMonths",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    // --- Verbatim tender_merged fields — each separate column ---
    {
      header: "documentFees",
      accessor: "documentFees",
      defaultWidth: 180,
      align: "right",
      type: "string",
    },
    {
      header: "contractPeriod",
      accessor: "contractPeriod",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "bidOfferValidity",
      accessor: "bidOfferValidity",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "bidValidityExpired",
      accessor: "bidValidityExpired",
      defaultWidth: 160,
      align: "center",
      type: "boolean",
    },
    {
      header: "location",
      accessor: "location",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "documentRequiredFromSeller",
      accessor: "documentRequiredFromSeller",
      defaultWidth: 260,
      align: "left",
      type: "string",
    },
    {
      header: "pastPerformance",
      accessor: "pastPerformance",
      defaultWidth: 220,
      align: "left",
      type: "string",
    },
    {
      header: "typeOfBid",
      accessor: "typeOfBid",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "technicalClarificationTimeAllowed",
      accessor: "technicalClarificationTimeAllowed",
      defaultWidth: 220,
      align: "left",
      type: "string",
    },
    {
      header: "mediationClause",
      accessor: "mediationClause",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "arbitrationClause",
      accessor: "arbitrationClause",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
    {
      header: "oemAverageTurnover",
      accessor: "oemAverageTurnover",
      defaultWidth: 200,
      align: "right",
      type: "string",
    },
    {
      header: "ePbgPercentage",
      accessor: "ePbgPercentage",
      defaultWidth: 160,
      align: "right",
      type: "string",
    },
    {
      header: "msmeExemption",
      accessor: "msmeExemption",
      defaultWidth: 180,
      align: "left",
      type: "string",
    },
    {
      header: "msePurchasePreference",
      accessor: "msePurchasePreference",
      defaultWidth: 200,
      align: "left",
      type: "string",
    },
  ];

  const PARTY_COLUMNS: ColumnDef[] = [
    { header: "Reference No", accessor: "referenceNo" as ColumnDef["accessor"], defaultWidth: 180, align: "left", type: "string" },
    { header: "Docket No", accessor: "docketNo", defaultWidth: 180, align: "left", type: "string" },
    { header: "Organization", accessor: "organization" as ColumnDef["accessor"], defaultWidth: 220, align: "left", type: "string" },
    { header: "ERP Party Name", accessor: "erpPartyName" as unknown as ColumnDef["accessor"], defaultWidth: 220, align: "left", type: "string" },
    { header: "Competitors", accessor: "competitors", defaultWidth: 250, align: "left", type: "string" },
    { header: "Our Rank", accessor: "ourRank", defaultWidth: 120, align: "center", type: "string" },
    { header: "Our Value", accessor: "ourValue", defaultWidth: 160, align: "right", type: "string" },
    { header: "L1 Name", accessor: "nameOfRank1", defaultWidth: 200, align: "left", type: "string" },
    { header: "L1 Price", accessor: "valueOfRank1", defaultWidth: 160, align: "right", type: "string" },
    { header: "Diff L1", accessor: "differenceBetweenRank1", defaultWidth: 140, align: "right", type: "string" },
    { header: "L2 Name", accessor: "nameOfRank2", defaultWidth: 200, align: "left", type: "string" },
    { header: "L2 Price", accessor: "valueOfRank2", defaultWidth: 160, align: "right", type: "string" },
    { header: "Diff L2", accessor: "differenceBetweenRank2", defaultWidth: 140, align: "right", type: "string" },
  ];

  const postParticipationAccessors = new Set([
    "bgNoUtrNo", "remarks", "loiPoNoAndDate",
    "competitors",
    "nextAction",
    "quotationNo", "currentStatus",
    "ourRank", "ourValue",
    "nameOfRank1", "valueOfRank1",
    "nameOfRank2", "valueOfRank2",
    "issuingBank", "expectedRaDate",
  ]);
  const postParticipationExcludeAccessors = new Set([
    "merged_office_consignees", "miiPurchasePreference", "tenderDocument",
    "reportings", "website", "raQualificationRule", "startupExemption",
    "minimumAverageAnnualTurnover", "yearsOfPastExperience", "ePbgDurationMonths",
    "beneficiaryBankDetails",
  ]);
  // UI-only hide for post-participation view (requested columns remain in data/model)
  const postParticipationHiddenAccessors = new Set([
    "publishedDate",
    "assignedDate",
    "claimDate",
    "statusCategory",
    "reason",
    "loiPoNoAndDate",
    "managementDecision",
    "catalogueDone",
    "participated",
  ]);
  const filteredForMode = variant === "party"
    ? PARTY_COLUMNS
    : showPostParticipationColumns
      ? columns.filter((col) => !postParticipationExcludeAccessors.has(col.accessor) && !(postParticipationHiddenAccessors.has(col.accessor) && !(showReasonColumn && col.accessor === "reason")))
      : columns.filter((col) => !postParticipationAccessors.has(col.accessor));
  const baseVisibleColumns = variant === "party"
    ? filteredForMode
    : showTypeTestColumn
      ? filteredForMode
      : filteredForMode.filter((col) => (col.accessor as string) !== "typeTests" && (col.accessor as string) !== "typetest");

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [columnPickerSearch, setColumnPickerSearch] = useState("");

  const visibleColumns = useMemo(() => {
    return baseVisibleColumns.filter((col) => columnVisibility[col.accessor] !== false);
  }, [baseVisibleColumns, columnVisibility]);

  // 2. States
  const [overrides, setOverrides] = useState<
    Record<
      string,
      {
        tenderUpdateStatus?: string;
        nextAction?: string | null;
        reverseAuctionApplicable?: boolean | null;
      }
    >
  >({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [editingCell, setEditingCell] = useState<{ id: string; accessor: string } | null>(null);

  // Dialog state for merged office name
  const [officeDialogRecord, setOfficeDialogRecord] = useState<EpcTenderRecord | null>(null);
  const [officeDialogSaving, setOfficeDialogSaving] = useState(false);
  const [websiteDialogRecord, setWebsiteDialogRecord] = useState<EpcTenderRecord | null>(null);
  const [reportingDialogRecord, setReportingDialogRecord] = useState<EpcTenderRecord | null>(null);
  const [catalogueUploadRow, setCatalogueUploadRow] = useState<EpcTenderRecord | null>(null);
  const [catalogueUploading, setCatalogueUploading] = useState(false);
  const [detailRecords, setDetailRecords] = useState<EpcTenderRecord[] | null>(null);

  const dispatch = useAppDispatch();
  const tenderData = useAppSelector((s) => s.tenders.data);
  const updatingCells = useAppSelector((s) => s.tenders.updatingCells);
  const bomByItemName = useAppSelector((s) => (s as any).utility?.bomByItemName ?? {});
  const bomTypesByItemName = useAppSelector((s) => (s as any).utility?.bomTypesByItemName ?? {});
  const utilityLoading = useAppSelector((s) => (s as any).utility?.loading ?? false);
  const [costingOverrides, setCostingOverrides] = useState<Record<string, { bomType?: string | null; bomCode?: string | null }>>({});
  const [savingBom, setSavingBom] = useState<Record<string, boolean>>({});

  const saveCell = useCallback(
    (record: EpcTenderRecord, accessor: string, draft: string) => {
      const cfg = EDITABLE_FIELDS[accessor];
      if (!cfg) return;
      if (!record.id) {
        toast.error("Database record ID not found. Please refresh.");
        return;
      }
      const parsed = cfg.parse?.(draft);
      if (parsed?.error) {
        toast.error(parsed.error);
        return;
      }
      const stored = cfg.toStored(draft);
      const current = cfg.fromStored(record);
      if (stored === current) {
        setEditingCell(null);
        return;
      }
      const key = `${record.id}-${accessor}`;
      setSavingKeys((prev) => ({ ...prev, [key]: true }));
      cfg
        .save(dispatch, record, stored, draft)
        .then(() => {
          toast.success(
            cfg.successMessage?.(record, draft) ??
              `${accessor} updated successfully!`,
          );
        })
        .catch((err: any) => {
          toast.error(err?.message || `Failed to update ${accessor}.`);
        })
        .finally(() => {
          setEditingCell(null);
          setSavingKeys((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        });
    },
    [dispatch],
  );

  const handleCostingBomUpdate = useCallback(
    async (costingId: number, field: "bomType" | "bomCode", value: string, itemName: string, currentBomType?: string | null, currentBomCode?: string | null) => {
      const normalized = value.trim() === "" ? null : value.trim();
      const key = `${costingId}-${field}`;
      setSavingBom((prev) => ({ ...prev, [key]: true }));
      // optimistic update
      setCostingOverrides((prev) => {
        const cur = prev[costingId] ?? {};
        if (field === "bomType") {
          const prevBomType = cur.bomType ?? currentBomType ?? null;
          if (normalized !== prevBomType) {
            // when type changes, validate current bomCode still valid for new type
            const opts = (bomByItemName[itemName] ?? []) as Array<{ bomType: string | null; bomId: string }>;
            const filteredIds = normalized ? opts.filter((o) => (o.bomType ?? "") === normalized).map((o) => o.bomId) : opts.map((o) => o.bomId);
            const existingCode = cur.bomCode ?? currentBomCode ?? null;
            const shouldKeep = existingCode && filteredIds.includes(existingCode);
            return { ...prev, [costingId]: { ...cur, bomType: normalized, bomCode: shouldKeep ? existingCode : null } };
          }
          return { ...prev, [costingId]: { ...cur, bomType: normalized } };
        }
        return { ...prev, [costingId]: { ...cur, bomCode: normalized } };
      });
      try {
        const curOverride = costingOverrides[costingId] ?? {};
        let body: Record<string, string | null> = {};
        if (field === "bomType") {
          const opts = (bomByItemName[itemName] ?? []) as Array<{ bomType: string | null; bomId: string }>;
          const filteredIds = normalized ? opts.filter((o) => (o.bomType ?? "") === normalized).map((o) => o.bomId) : opts.map((o) => o.bomId);
          const existingCode = curOverride.bomCode ?? currentBomCode ?? null;
          const shouldKeep = existingCode && filteredIds.includes(existingCode);
          body = { bomType: normalized, bomCode: shouldKeep ? existingCode : normalized == null ? null : null };
          // if we cleared, we need to send bomCode null explicitly
          if (!shouldKeep) body.bomCode = null;
          else delete (body as any).bomCode;
          // if body only has bomType and we kept code, don't send bomCode to preserve
          if (shouldKeep) delete body.bomCode;
        } else {
          body = { bomCode: normalized };
        }
        // if body empty (kept code case), ensure at least bomType sent
        if (Object.keys(body).length === 0) body = { [field]: normalized } as any;
        const res = await fetch(`/api/costing-sheet-details/${costingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update");
        setCostingOverrides((prev) => ({
          ...prev,
          [costingId]: {
            bomType: data.data?.bomType ?? normalized ?? prev[costingId]?.bomType ?? currentBomType ?? null,
            bomCode: data.data?.bomCode ?? (field === "bomType" && body.bomCode === null ? null : field === "bomCode" ? normalized : prev[costingId]?.bomCode ?? currentBomCode ?? null),
          },
        }));
        toast.success(`${field} updated`);
      } catch (err: any) {
        toast.error(err?.message || `Failed to update ${field}`);
        setCostingOverrides((prev) => {
          const copy = { ...prev };
          const cur = copy[costingId] ?? {};
          if (field === "bomType") copy[costingId] = { ...cur, bomType: currentBomType ?? null };
          else copy[costingId] = { ...cur, bomCode: currentBomCode ?? null };
          return copy;
        });
      } finally {
        setSavingBom((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
      }
    },
    [bomByItemName, costingOverrides]
  );

  const handleMergedFieldSave = useCallback(
    (record: EpcTenderRecord, field: string, currentValue: string, setEditingId: (id: string | null) => void, setEditValue: (v: string) => void, onSuccess?: () => void) => {
      if (!record.id) {
        toast.error("Database record ID not found. Please refresh.");
        return;
      }
      const newVal = (() => {
        if (field === "emdPaymentMode") return currentValue;
        return currentValue.trim();
      })();
      const oldVal = record[field as keyof EpcTenderRecord] ?? "";
      if (newVal === String(oldVal)) {
        setEditingId(null);
        return;
      }
      const key = `${record.id}-${field}`;
      setSavingKeys((prev) => ({ ...prev, [key]: true }));
      dispatch(
        updateTenderMergedField({
          rowIndex: 0,
          field,
          value: newVal,
          tenderMergedId: Number(record.id),
          oldValue: String(oldVal),
        }),
      )
        .unwrap()
        .then(() => {
          toast.success(`${field} updated successfully!`);
          onSuccess?.();
        })
        .catch((err: any) => {
          toast.error(err?.message || `Failed to update ${field}.`);
        })
        .finally(() => {
          setEditingId(null);
          setEditValue("");
          setSavingKeys((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        });
    },
    [dispatch],
  );

  const handleOfficeDialogSave = useCallback(
    async (params: { tenderMergedId: number; officeName: string; consigneesReportingOfficer: string; oldOfficeName: string; oldConsignees: string }) => {
      setOfficeDialogSaving(true);
      try {
        if (params.officeName !== params.oldOfficeName) {
          await dispatch(
            updateTenderMergedField({
              rowIndex: 0,
              field: "officeName",
              value: params.officeName,
              tenderMergedId: params.tenderMergedId,
              oldValue: params.oldOfficeName,
            }),
          ).unwrap();
        }
        if (params.consigneesReportingOfficer !== params.oldConsignees) {
          await dispatch(
            updateTenderMergedField({
              rowIndex: 0,
              field: "consigneesReportingOfficer",
              value: params.consigneesReportingOfficer,
              tenderMergedId: params.tenderMergedId,
              oldValue: params.oldConsignees,
            }),
          ).unwrap();
        }
        toast.success("Office details updated!");
        setOfficeDialogRecord(null);
      } catch (err: any) {
        toast.error(err?.message || "Failed to update office details.");
      } finally {
        setOfficeDialogSaving(false);
      }
    },
    [dispatch],
  );

  const handleWebsiteSave = useCallback(
    async (params: { tenderMergedId: number; website: string; oldValue: string }) => {
      try {
        await dispatch(updateWebsiteMapping(params)).unwrap();
        toast.success("Website updated!");
        setWebsiteDialogRecord(null);
      } catch (err: any) {
        toast.error(err?.message || "Failed to update website.");
      }
    },
    [dispatch],
  );

  const handleCatalogueUpload = useCallback(
    (params: { tenderMergedId: number; file: File; fileType: string }) => {
      const toastId = toast.loading("Uploading catalogue file...");
      setCatalogueUploading(true);
      dispatch(
        uploadTenderDocument({
          tenderMergedId: params.tenderMergedId,
          file: params.file,
          fileType: params.fileType,
        }),
      )
        .unwrap()
        .then(() => {
          const rowIndex = tenderData?.rows.findIndex(
            (r) => String(r.id) === String(params.tenderMergedId),
          ) ?? -1;
          const oldValue = rowIndex >= 0
            ? String(tenderData!.rows[rowIndex]?.catalogueDone ?? "")
            : "";
          dispatch(
            updateTenderCell({
              rowIndex,
              field: "catalogueDone",
              value: "YES",
              tenderMergedId: params.tenderMergedId,
              oldValue,
            }),
          )
            .unwrap()
            .then(() => {
              toast.success("Catalogue uploaded and marked as done!", { id: toastId });
              setCatalogueUploadRow(null);
            })
            .catch((err: any) => {
              toast.error(err?.message || "Failed to update Catalogue Done.", { id: toastId });
            });
        })
        .catch((err: any) => {
          toast.error(err?.message || "Catalogue upload failed.", { id: toastId });
        })
        .finally(() => {
          setCatalogueUploading(false);
        });
    },
    [dispatch, tenderData],
  );

  const handleReportingSave = useCallback(
    async (params: { tenderMergedId: number; reportings: string; oldValue: string }) => {
      try {
        await dispatch(
          updateTenderMergedField({
            rowIndex: 0,
            field: "reportings",
            value: params.reportings,
            tenderMergedId: params.tenderMergedId,
            oldValue: params.oldValue,
          }),
        ).unwrap();
        toast.success("Reporting officers updated!");
        setReportingDialogRecord(null);
      } catch (err: any) {
        toast.error(err?.message || "Failed to update reporting officers.");
      }
    },
    [dispatch],
  );

  const handleEmdPaymentModeChange = useCallback(
    (record: EpcTenderRecord, newValue: string) => {
      handleMergedFieldSave(record, "emdPaymentMode", newValue, () => {}, () => {});
    },
    [handleMergedFieldSave],
  );

  const handleBidValidityExpiredChange = useCallback(
    (record: EpcTenderRecord, newValue: boolean) => {
      if (!record.id) return;
      const oldVal = record.bidValidityExpired ? "true" : "false";
      const newVal = newValue ? "true" : "false";
      if (newVal === oldVal) return;
      const key = `${record.id}-bidValidityExpired`;
      setSavingKeys((prev) => ({ ...prev, [key]: true }));
      dispatch(
        updateTenderMergedField({
          rowIndex: 0,
          field: "bidValidityExpired",
          value: newVal,
          tenderMergedId: Number(record.id),
          oldValue: oldVal,
        }),
      )
        .unwrap()
        .then(() => {
          toast.success("Bid validity expired updated!");
        })
        .catch((err: any) => {
          toast.error(err?.message || "Failed to update bid validity expired.");
        })
        .finally(() => {
          setSavingKeys((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        });
    },
    [dispatch],
  );

  const buildRaWebhookData = useCallback(
    (
      record: EpcTenderRecord,
      overrideRa?: boolean | null,
    ): ReverseAuctionWebhookData => {
      const reduxRow = tenderData?.rows.find(
        (r) => String(r.id) === String(record.id),
      );
      const assignedIds = (reduxRow?.assignedTo ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      const firstAssoc = tenderData?.associations.find((a) =>
        assignedIds.includes(a.id),
      );
      return {
        tenderMergedId: Number(record.id ?? 0),
        organization: record.nameOfTheClient ?? null,
        docketNo: record.docketNo ?? null,
        referenceNo: record.tenderNoNitNo ?? null,
        reverseAuctionApplicable:
          overrideRa !== undefined
            ? overrideRa
            : record.reverseAuctionApplicable,
        reverseAuctionStartDate: record.reverseAuctionStartDate ?? null,
        reverseAuctionEndDate: record.reverseAuctionEndDate ?? null,
        associateName: firstAssoc?.name ?? null,
        associateEmail: firstAssoc?.email ?? null,
      };
    },
    [tenderData],
  );

  const handleUpdate = async (
    record: EpcTenderRecord,
    field: "tenderUpdateStatus" | "nextAction" | "reverseAuctionApplicable",
    value: any,
  ) => {
    if (!record.id) {
      toast.error("Database record ID is not found. Please refresh and try again.");
      return;
    }
    if (field === "reverseAuctionApplicable") {
      const raRule = record.raQualificationRule;
      if (raRule != null && raRule !== "") {
        toast.error("Reverse Auction Applicable cannot be edited when RA Qualification Rule is set.");
        return;
      }
    }
    const key = `${record.id}::${field}`;
    setSavingKeys((prev) => ({ ...prev, [key]: true }));

    const previousValue =
      overrides[record.id]?.[field] !== undefined
        ? overrides[record.id]?.[field]
        : record[field as keyof EpcTenderRecord];

    setOverrides((prev) => ({
      ...prev,
      [record.id!]: {
        ...prev[record.id!],
        [field]: value,
      },
    }));

    try {
      const currentStatus =
        field === "tenderUpdateStatus"
          ? value
          : (overrides[record.id]?.tenderUpdateStatus ??
            record.tenderUpdateStatus ??
            "OPEN");
      const currentAction =
        field === "nextAction"
          ? value
          : overrides[record.id]?.nextAction !== undefined
            ? overrides[record.id]?.nextAction
            : (record.nextAction ?? null);
      const currentRa =
        field === "reverseAuctionApplicable"
          ? value
          : overrides[record.id]?.reverseAuctionApplicable !== undefined
            ? overrides[record.id]?.reverseAuctionApplicable
            : (record.reverseAuctionApplicable ?? false);

      await dispatch(
        updateTenderStatusAndAction({
          tenderMergedId: Number(record.id),
          tenderUpdateStatus: currentStatus,
          nextAction: currentAction,
          reverseAuctionApplicable: currentRa,
        }),
      ).unwrap();

      if (field === "reverseAuctionApplicable") {
        dispatch(
          triggerReverseAuctionWebhook(buildRaWebhookData(record, currentRa)),
        );
      }

      toast.success(`Tender ${record.docketNo} updated successfully!`);
    } catch (err: any) {
      console.error(err);
      setOverrides((prev) => ({
        ...prev,
        [record.id!]: {
          ...prev[record.id!],
          [field]: previousValue,
        },
      }));
      toast.error(err.message || "Failed to save tender updates. Reverting changes.");
    } finally {
      setSavingKeys((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  const [globalSearch, setGlobalSearch] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<
    keyof EpcTenderRecord | "rawMaterials" | "files" | "boqChart" | "merged_office_consignees" | "tenderDocument" | "itemSchedules" | null
  >("lastDateOfSubmission");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>(defaultEndDate ?? "");
  const [datePreset, setDatePreset] = useState<
    "" | "thisWeek" | "thisMonth" | "thisYear"
  >("");
  const [raStartFrom, setRaStartFrom] = useState<string>("");
  const [raStartTo, setRaStartTo] = useState<string>("");
  const [raEndFrom, setRaEndFrom] = useState<string>("");
  const [raEndTo, setRaEndTo] = useState<string>("");

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(50);

  const [selectedFiles, setSelectedFiles] = useState<any[]>([]);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] =
    useState<boolean>(false);
  const [multiSelectFilters, setMultiSelectFilters] = useState<
    Record<string, string[]>
  >({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [columnSearchText, setColumnSearchText] = useState<
    Record<string, string>
  >({});
  const [remarksTextFilter, setRemarksTextFilter] = useState<string>("");
  const [remarksDropdownFilter, setRemarksDropdownFilter] =
    useState<string>("All");
  const [proposedErpItemTextFilter, setProposedErpItemTextFilter] =
    useState<string>("");
  const [proposedErpItemCategoryFilter, setProposedErpItemCategoryFilter] =
    useState<string>("All");

  const toggleFilter = (accessor: string, value: string) => {
    setMultiSelectFilters((prev) => {
      const current = prev[accessor] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [accessor]: next };
    });
    setCurrentPage(1);
  };

  const selectAllFilter = (accessor: string) => {
    const all = [...(uniqueValueCache[accessor] ?? [])];
    if (BOOLEAN_COLUMNS.has(accessor)) {
      all.push("Yes", "No");
    }
    all.push("(Blank)");
    setMultiSelectFilters((prev) => ({ ...prev, [accessor]: all }));
    setCurrentPage(1);
  };

  const clearFilter = (accessor: string) => {
    setMultiSelectFilters((prev) => {
      const next = { ...prev };
      delete next[accessor];
      return next;
    });
    setCurrentPage(1);
  };

  useEffect(() => {
    if (!openDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      const el = dropdownRefs.current[openDropdown];
      if (el && !el.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown]);

  React.useEffect(() => {
    if (clearTrigger) {
      setGlobalSearch("");
      setStartDate("");
      setEndDate("");
      setMultiSelectFilters({});
      setOpenDropdown(null);
      setColumnSearchText({});
      setRemarksTextFilter("");
      setRemarksDropdownFilter("All");
      setProposedErpItemTextFilter("");
      setProposedErpItemCategoryFilter("All");
      setCurrentPage(1);
      setDatePreset("");
      setRaStartFrom("");
      setRaStartTo("");
      setRaEndFrom("");
      setRaEndTo("");
    }
  }, [clearTrigger]);

  const getDateRange = useCallback(() => {
    if (datePreset) {
      const now = new Date();
      let fromKey: string;
      let toKey: string;
      if (datePreset === "thisWeek") {
        const r = getISTWeekRange(now);
        fromKey = r.fromKey;
        toKey = r.toKey;
      } else if (datePreset === "thisMonth") {
        const r = getISTMonthRange(now);
        fromKey = r.fromKey;
        toKey = r.toKey;
      } else {
        const r = getISTYearRange(now);
        fromKey = r.fromKey;
        toKey = r.toKey;
      }
      // Create Dates whose IST key equals the desired boundaries (for isBeforeTodayIST/ filtering)
      return { from: new Date(fromKey), to: new Date(toKey) };
    }
    return {
      from: startDate ? new Date(startDate) : undefined,
      to: endDate ? new Date(endDate) : undefined,
    };
  }, [datePreset, startDate, endDate]);

  const activeDateRange: DateRange | undefined = useMemo(() => {
    const { from, to } = getDateRange();
    if (!from) return undefined;
    return { from, to };
  }, [getDateRange]);

  const dateRangeLabel = useMemo(() => {
    if (datePreset === "thisWeek") return "This Week";
    if (datePreset === "thisMonth") return "This Month";
    if (datePreset === "thisYear") return "This Year";
    const { from, to } = getDateRange();
    const istFmt = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
      }).format(d);
    if (from && to) {
      return `${istFmt(from)} - ${istFmt(to)}`;
    }
    if (from) return `${istFmt(from)} onwards`;
    if (to) return `Upto ${istFmt(to)}`;
    return "All dates";
  }, [datePreset, getDateRange]);

  const handleDateRangeSelect = useCallback(
    (range?: DateRange) => {
      setDatePreset("");
      if (range?.from) {
        const from = new Date(range.from);
        from.setHours(0, 0, 0, 0);
        setStartDate(from.toISOString());
        if (range.to) {
          const to = new Date(range.to);
          to.setHours(23, 59, 59, 999);
          setEndDate(to.toISOString());
        } else {
          setEndDate("");
        }
      } else {
        setStartDate("");
        setEndDate("");
      }
      setCurrentPage(1);
    },
    [],
  );

  const buildDateRange = useCallback((fromStr: string, toStr: string) => {
    return {
      from: fromStr ? new Date(fromStr) : undefined,
      to: toStr ? new Date(toStr) : undefined,
    };
  }, []);

  const raStartActiveRange: DateRange | undefined = useMemo(() => {
    const { from, to } = buildDateRange(raStartFrom, raStartTo);
    if (!from) return undefined;
    return { from, to };
  }, [buildDateRange, raStartFrom, raStartTo]);

  const raEndActiveRange: DateRange | undefined = useMemo(() => {
    const { from, to } = buildDateRange(raEndFrom, raEndTo);
    if (!from) return undefined;
    return { from, to };
  }, [buildDateRange, raEndFrom, raEndTo]);

  const formatRangeLabel = useCallback((fromStr: string, toStr: string) => {
    const { from, to } = buildDateRange(fromStr, toStr);
    const istFmt = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
      }).format(d);
    if (from && to) return `${istFmt(from)} - ${istFmt(to)}`;
    if (from) return `from ${istFmt(from)}`;
    if (to) return `upto ${istFmt(to)}`;
    return "All";
  }, [buildDateRange]);

  const handleRaStartSelect = useCallback(
    (range?: DateRange) => {
      if (range?.from) {
        const from = new Date(range.from);
        from.setHours(0, 0, 0, 0);
        setRaStartFrom(from.toISOString());
        if (range.to) {
          const to = new Date(range.to);
          to.setHours(23, 59, 59, 999);
          setRaStartTo(to.toISOString());
        } else {
          setRaStartTo("");
        }
      } else {
        setRaStartFrom("");
        setRaStartTo("");
      }
      setCurrentPage(1);
    },
    [],
  );

  const handleRaEndSelect = useCallback(
    (range?: DateRange) => {
      if (range?.from) {
        const from = new Date(range.from);
        from.setHours(0, 0, 0, 0);
        setRaEndFrom(from.toISOString());
        if (range.to) {
          const to = new Date(range.to);
          to.setHours(23, 59, 59, 999);
          setRaEndTo(to.toISOString());
        } else {
          setRaEndTo("");
        }
      } else {
        setRaEndFrom("");
        setRaEndTo("");
      }
      setCurrentPage(1);
    },
    [],
  );

  const matchesRaDateRange = useCallback(
    (date: Date | null | undefined, fromStr: string, toStr: string) => {
      if (!fromStr && !toStr) return true;
      if (!date || isNaN(date.getTime())) return false;
      const { from, to } = buildDateRange(fromStr, toStr);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    },
    [buildDateRange],
  );

  // ---------------------------------------------------------------------------
  // Filtering pipeline
  //
  // Split into two stages so filter-option derivation no longer has to re-run the
  // whole chain once per column:
  //   * baseStageFiltered - filters not tied to any single column (global search,
  //     deadline range, RA start/end ranges). Computed once per render.
  //   * columnPredicates  - filters that *are* tied to a column, each tagged with
  //     its accessor so a caller can exclude that column's own predicate.
  //
  // getFilteredRecordsExcept(x) is then stage 1 plus every stage-2 predicate whose
  // key !== x - the same result the old monolithic function produced, without the
  // unconditional `[...records]` copy it used to open with.
  // ---------------------------------------------------------------------------

  const baseStageFiltered = useMemo(() => {
    let result: EpcTenderRecord[] = records;

    if (globalSearch.trim() !== "") {
      const searchLower = globalSearch.toLowerCase().trim();
      result = result.filter((record) => {
        const docNo = record.docketNo || "";
        const client = record.nameOfTheClient || "";
        const nit = record.tenderNoNitNo || "";
        const category = record.itemCategory || "";
        const schedules = (record.itemSchedules ?? []).join(" ");
        const comps = record.competitors || "";
        return (
          docNo.toLowerCase().includes(searchLower) ||
          client.toLowerCase().includes(searchLower) ||
          nit.toLowerCase().includes(searchLower) ||
          category.toLowerCase().includes(searchLower) ||
          schedules.toLowerCase().includes(searchLower) ||
          comps.toLowerCase().includes(searchLower)
        );
      });
    }

    const { from: dateFrom, to: dateTo } = getDateRange();
    if (dateFrom || dateTo) {
      // Hoisted out of the row callback - these were recomputed once per row.
      const fromKey = dateFrom ? toISTDateKey(dateFrom) : null;
      const toKey = dateTo ? toISTDateKey(dateTo) : null;
      result = result.filter((record) => {
        const dateVal = record.lastDateOfSubmission;
        if (!(dateVal instanceof Date) || isNaN(dateVal.getTime())) return false;
        const dateKey = toISTDateKey(dateVal);
        if (!dateKey) return false;
        if (fromKey && dateKey < fromKey) return false;
        if (toKey && dateKey > toKey) return false;
        return true;
      });
    }

    if (raStartFrom || raStartTo) {
      result = result.filter((record) =>
        matchesRaDateRange(
          record.reverseAuctionStartDate,
          raStartFrom,
          raStartTo,
        ),
      );
    }
    if (raEndFrom || raEndTo) {
      result = result.filter((record) =>
        matchesRaDateRange(record.reverseAuctionEndDate, raEndFrom, raEndTo),
      );
    }

    return result;
    // getDateRange() reads datePreset/startDate/endDate, all listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    records,
    globalSearch,
    startDate,
    endDate,
    datePreset,
    raStartFrom,
    raStartTo,
    raEndFrom,
    raEndTo,
  ]);

  type ColumnPredicate = { key: string; test: (r: EpcTenderRecord) => boolean };

  const columnPredicates = useMemo<ColumnPredicate[]>(() => {
    const preds: ColumnPredicate[] = [];

    for (const [accessor, selected] of Object.entries(multiSelectFilters)) {
      if (selected.length === 0) continue;
      preds.push({
        key: accessor,
        test: (r) => {
          if (BOOLEAN_COLUMNS.has(accessor)) {
            const val = r[accessor as keyof EpcTenderRecord];
            if (selected.includes("Yes") && val === true) return true;
            if (selected.includes("No") && val === false) return true;
            if (selected.includes("(Blank)") && val == null) return true;
            return false;
          }
          const cellStr = String(r[accessor as keyof EpcTenderRecord] ?? "");
          if (!cellStr.trim()) return selected.includes("(Blank)");
          return selected.includes(cellStr);
        },
      });
    }

    for (const [accessor, searchVal] of Object.entries(columnSearchText)) {
      if (!searchVal.trim()) continue;
      const searchLower = searchVal.toLowerCase().trim();
      preds.push({
        key: accessor,
        test: (r) =>
          String(r[accessor as keyof EpcTenderRecord] ?? "")
            .toLowerCase()
            .includes(searchLower),
      });
    }

    if (remarksDropdownFilter !== "All") {
      preds.push({
        key: "remarks",
        test: (r) => r.remarks === remarksDropdownFilter,
      });
    }

    if (proposedErpItemCategoryFilter !== "All") {
      preds.push({
        key: "proposedErpItemName",
        test: (r) =>
          matchesErpItemCategory(
            r.proposedErpItemName,
            proposedErpItemCategoryFilter,
          ),
      });
    }
    if (proposedErpItemTextFilter.trim() !== "") {
      const searchLower = proposedErpItemTextFilter.toLowerCase().trim();
      preds.push({
        key: "proposedErpItemName",
        test: (r) =>
          !!r.proposedErpItemName &&
          r.proposedErpItemName.toLowerCase().includes(searchLower),
      });
    }

    return preds;
  }, [
    multiSelectFilters,
    columnSearchText,
    remarksDropdownFilter,
    proposedErpItemCategoryFilter,
    proposedErpItemTextFilter,
  ]);

  const getFilteredRecordsExcept = useCallback(
    (excludeAccessor: string | null): EpcTenderRecord[] => {
      if (columnPredicates.length === 0) return baseStageFiltered;
      return baseStageFiltered.filter((r) => {
        for (const p of columnPredicates) {
          if (p.key === excludeAccessor) continue;
          if (!p.test(r)) return false;
        }
        return true;
      });
    },
    [baseStageFiltered, columnPredicates],
  );

  /**
   * Option list for the *currently open* filter dropdown only.
   *
   * This previously built option lists for all ~47 filterable columns on every
   * render, each via its own full re-filter of the dataset - O(columns x rows)
   * with ~50 array copies per render. Nothing reads an entry unless that column
   * has its dropdown open, so it is now derived on demand: zero passes while
   * browsing, one while a dropdown is open.
   */
  const uniqueValueCache = useMemo(() => {
    const cache: Record<string, string[]> = {};
    if (!openDropdown || SKIP_FILTER_COLUMNS.has(openDropdown)) return cache;
    const values = new Set<string>();
    for (const r of getFilteredRecordsExcept(openDropdown)) {
      const v = String(r[openDropdown as keyof EpcTenderRecord] ?? "");
      if (v.trim() !== "") values.add(v);
    }
    cache[openDropdown] = Array.from(values).sort();
    return cache;
  }, [openDropdown, getFilteredRecordsExcept]);

  const tenderStatusOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const r of getFilteredRecordsExcept("tenderUpdateStatus")) {
      if (r.tenderUpdateStatus) codes.add(String(r.tenderUpdateStatus));
    }
    return TENDER_UPDATE_STATUS_FILTER_OPTIONS.filter(([code]) =>
      codes.has(code),
    );
  }, [getFilteredRecordsExcept]);

  const nextActionOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const r of getFilteredRecordsExcept("nextAction")) {
      if (r.nextAction) codes.add(String(r.nextAction));
    }
    return NEXT_ACTION_FILTER_OPTIONS.filter(([code]) => codes.has(code));
  }, [getFilteredRecordsExcept]);

  const uniqueRemarks = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of getFilteredRecordsExcept("remarks")) {
      const val = r.remarks ? r.remarks.trim() : "";
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return Object.keys(counts)
      .filter((key) => counts[key] > 1)
      .sort();
  }, [getFilteredRecordsExcept]);

  const handleOpenAttachmentModal = (files: any[]) => {
    setSelectedFiles(files);
    setIsAttachmentModalOpen(true);
  };

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => {
      const initialWidths: Record<string, number> = {};
      visibleColumns.forEach((col) => {
        initialWidths[col.accessor] = col.defaultWidth;
      });
      return initialWidths;
    },
  );

  // Sticky left offsets for pinned columns (accumulate widths of sticky columns)
  const stickyLeftOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    for (const col of visibleColumns) {
      if (col.sticky) {
        offsets[col.accessor] = acc;
        acc += columnWidths[col.accessor] ?? col.defaultWidth;
      }
    }
    return offsets;
  }, [visibleColumns, columnWidths]);

  // DOM Ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Resize column state refs
  const resizingColumnRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // 3. Draggable Column Resizing Handlers
  const handleResizeStart = (
    e: React.MouseEvent,
    accessor: string,
    currentWidth: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumnRef.current = accessor;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "col-resize";
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumnRef.current) return;
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(50, startWidthRef.current + diff); // Minimum width 50px
    setColumnWidths((prev) => ({
      ...prev,
      [resizingColumnRef.current!]: newWidth,
    }));
  };

  const handleResizeEnd = () => {
    resizingColumnRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
  };

  // 4. Sorting Handler
  const handleSort = (
    column: keyof EpcTenderRecord | "rawMaterials" | "files" | "boqChart" | "merged_office_consignees" | "tenderDocument" | "itemSchedules",
  ) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  const handleClearSort = () => {
    setSortColumn(null);
    setSortDirection("desc");
    setCurrentPage(1);
  };

  // 5. Processing Data (Filtering & Sorting)
  const processedRecords = useMemo(() => {
    // Start from the prop; every .filter() below already returns a fresh array.
    // A copy is only needed if nothing filtered, since the sort below is in-place.
    let result: EpcTenderRecord[] = records;

    // Global Text Search
    if (globalSearch.trim() !== "") {
      const searchLower = globalSearch.toLowerCase().trim();
      result = result.filter((record) => {
        return (
          record.docketNo.toLowerCase().includes(searchLower) ||
          record.nameOfTheClient.toLowerCase().includes(searchLower) ||
          record.tenderNoNitNo.toLowerCase().includes(searchLower) ||
          record.tenderFor.toLowerCase().includes(searchLower) ||
          record.tenderPrepareBy.toLowerCase().includes(searchLower) ||
          record.currentStatus.toLowerCase().includes(searchLower) ||
          (record.itemCategory &&
            record.itemCategory.toLowerCase().includes(searchLower)) ||
          ((record.itemSchedules ?? []).join(" ").toLowerCase().includes(searchLower)) ||
          (record.remarks &&
            record.remarks.toLowerCase().includes(searchLower)) ||
          (record.competitors &&
            record.competitors.toLowerCase().includes(searchLower)) ||
          (record.nameOfWorkDescription &&
            record.nameOfWorkDescription.toLowerCase().includes(searchLower))
        );
      });
    }

    // Date Range Filter on lastDateOfSubmission
    const { from: dateFrom, to: dateTo } = getDateRange();
    if (dateFrom || dateTo) {
      result = result.filter((record) => {
        if (!record.lastDateOfSubmission) return false;
        const dateVal = record.lastDateOfSubmission;

        if (!(dateVal instanceof Date) || isNaN(dateVal.getTime())) {
          return false;
        }

        const dateKey = toISTDateKey(dateVal);
        const fromKey = dateFrom ? toISTDateKey(dateFrom) : null;
        const toKey = dateTo ? toISTDateKey(dateTo) : null;
        if (!dateKey) return false;
        if (fromKey && dateKey < fromKey) return false;
        if (toKey && dateKey > toKey) return false;

        return true;
      });
    }

    if (raStartFrom || raStartTo) {
      result = result.filter((record) =>
        matchesRaDateRange(
          record.reverseAuctionStartDate,
          raStartFrom,
          raStartTo,
        ),
      );
    }
    if (raEndFrom || raEndTo) {
      result = result.filter((record) =>
        matchesRaDateRange(
          record.reverseAuctionEndDate,
          raEndFrom,
          raEndTo,
        ),
      );
    }

    // Column Header Filters (multi-select)
    for (const [accessor, selected] of Object.entries(multiSelectFilters)) {
      if (selected.length === 0) continue;
      result = result.filter((r) => {
        if (BOOLEAN_COLUMNS.has(accessor)) {
          const val = r[accessor as keyof EpcTenderRecord];
          if (selected.includes("Yes") && val === true) return true;
          if (selected.includes("No") && val === false) return true;
          if (selected.includes("(Blank)") && (val == null)) return true;
          return false;
        }
        const cellStr = String(r[accessor as keyof EpcTenderRecord] ?? "");
        if (!cellStr.trim()) return selected.includes("(Blank)");
        return selected.includes(cellStr);
      });
    }

    // Column Search Text Filters
    for (const [accessor, searchVal] of Object.entries(columnSearchText)) {
      if (!searchVal.trim()) continue;
      const searchLower = searchVal.toLowerCase().trim();
      result = result.filter((r) => {
        const cellVal = String(
          r[accessor as keyof EpcTenderRecord] ?? "",
        ).toLowerCase();
        return cellVal.includes(searchLower);
      });
    }

    // Column Remarks Header Filters
    if (remarksDropdownFilter !== "All") {
      result = result.filter(
        (record) => record.remarks === remarksDropdownFilter,
      );
    }
    if (remarksTextFilter.trim() !== "") {
      const searchLower = remarksTextFilter.toLowerCase().trim();
      result = result.filter(
        (record) =>
          record.remarks && record.remarks.toLowerCase().includes(searchLower),
      );
    }

    // Proposed ERP Item Name Header Filters
    if (proposedErpItemCategoryFilter !== "All") {
      result = result.filter((record) =>
        matchesErpItemCategory(
          record.proposedErpItemName,
          proposedErpItemCategoryFilter,
        ),
      );
    }
    if (proposedErpItemTextFilter.trim() !== "") {
      const searchLower = proposedErpItemTextFilter.toLowerCase().trim();
      result = result.filter(
        (record) =>
          record.proposedErpItemName &&
          record.proposedErpItemName.toLowerCase().includes(searchLower),
      );
    }

    // Sorting — applied last on the fully filtered set so order is definitive
    if (sortColumn) {
      if (result === records) result = [...records];
      result.sort((a, b) => {
        let valA: any;
        let valB: any;

        if (sortColumn === "rawMaterials") {
          valA = countRawMaterials(a.rawMaterials);
          valB = countRawMaterials(b.rawMaterials);
        } else if (sortColumn === "files") {
          const getFileCount = (r: EpcTenderRecord) => {
            if (!r.tenderFiles) return 0;
            try {
              const files = JSON.parse(r.tenderFiles);
              return Array.isArray(files) ? files.length : 0;
            } catch { return 0; }
          };
          valA = getFileCount(a);
          valB = getFileCount(b);
        } else if (sortColumn === "boqChart") {
          const getHasBoq = (r: EpcTenderRecord) => {
            if (r.boqFileId) return 1;
            if (!r.tenderFiles) return 0;
            try {
              const files: Array<{ name: string; tags: string[] }> = JSON.parse(r.tenderFiles);
              return files.some((f) => {
                const lower = (f.name || "").toLowerCase();
                return lower.includes("boqcomparativechart") ||
                       lower.includes("boq_comparative") ||
                       lower.includes("boq comparative") ||
                       f.tags?.includes("boqComparativeChart");
              }) ? 1 : 0;
            } catch { return 0; }
          };
          valA = getHasBoq(a);
          valB = getHasBoq(b);
        } else if (sortColumn === "merged_office_consignees") {
          valA = `${a.officeName || ""} ${a.consigneesReportingOfficer || ""}`;
          valB = `${b.officeName || ""} ${b.consigneesReportingOfficer || ""}`;
        } else if (sortColumn === "tenderDocument") {
          const getHasDoc = (r: EpcTenderRecord) => {
            if (!r.tenderFiles) return 0;
            try {
              const files: Array<{ tags: string[] }> = JSON.parse(r.tenderFiles);
              return files.some((f) => f.tags?.includes("tenderDocument")) ? 1 : 0;
            } catch { return 0; }
          };
          valA = getHasDoc(a);
          valB = getHasDoc(b);
        } else if (sortColumn === "attachmentUrl") {
          const getHasCosting = (r: EpcTenderRecord) => {
            if (!r.tenderFiles) return 0;
            try {
              const files: Array<{ tags: string[] }> = JSON.parse(r.tenderFiles);
              return files.some((f) => f.tags?.includes("costingAttachment")) ? 1 : 0;
            } catch { return 0; }
          };
          valA = getHasCosting(a);
          valB = getHasCosting(b);
        } else {
          valA = a[sortColumn as keyof EpcTenderRecord];
          valB = b[sortColumn as keyof EpcTenderRecord];
        }

        if (valA === valB) return 0;
        if (valA === null || valA === undefined)
          return sortDirection === "asc" ? -1 : 1;
        if (valB === null || valB === undefined)
          return sortDirection === "asc" ? 1 : -1;

        if (valA instanceof Date && valB instanceof Date) {
          return sortDirection === "asc"
            ? valA.getTime() - valB.getTime()
            : valB.getTime() - valA.getTime();
        }

        if (typeof valA === "number" && typeof valB === "number") {
          return sortDirection === "asc" ? valA - valB : valB - valA;
        }

        return sortDirection === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    return result;
  }, [
    records,
    globalSearch,
    sortColumn,
    sortDirection,
    startDate,
    endDate,
    datePreset,
    raStartFrom,
    raStartTo,
    raEndFrom,
    raEndTo,
    multiSelectFilters,
    columnSearchText,
    remarksTextFilter,
    remarksDropdownFilter,
    proposedErpItemTextFilter,
    proposedErpItemCategoryFilter,
  ]);

  // 6. Group by Docket No
  interface DocketGroup {
    docketNo: string;
    records: EpcTenderRecord[];
  }

  const getDocketGroupKey = (record: EpcTenderRecord): string => {
    const raw = String(record.docketNo ?? "").trim();
    if (!raw) return `__no_docket_${record.id}`;
    return normalizeDocketKey(raw);
  };

  const processedGroups = useMemo((): DocketGroup[] => {
    // Map preserves insertion order, so a single pass yields the same
    // first-seen group ordering the old two-pass version produced — with half
    // the getDocketGroupKey()/normalizeDocketKey() calls.
    const groupMap = new Map<string, EpcTenderRecord[]>();
    for (const record of processedRecords) {
      const key = getDocketGroupKey(record);
      const existing = groupMap.get(key);
      if (existing) existing.push(record);
      else groupMap.set(key, [record]);
    }
    const groups: DocketGroup[] = [];
    for (const [docketNo, records] of groupMap) {
      groups.push({ docketNo, records });
    }
    return groups;
  }, [processedRecords]);

  // 7. Pagination Calculations (by groups)
  const totalRecords = processedGroups.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;

  // Adjust current page if out of bounds
  const activePage = Math.min(currentPage, totalPages);

  const paginatedGroups = useMemo(() => {
    const startIndex = (activePage - 1) * rowsPerPage;
    return processedGroups.slice(startIndex, startIndex + rowsPerPage);
  }, [processedGroups, activePage, rowsPerPage]);

  // Reset page when search, sort, date filters, or row limit changes
  useEffect(() => {
    setCurrentPage(1);
  }, [globalSearch, sortColumn, sortDirection, rowsPerPage, startDate, endDate, datePreset, raStartFrom, raStartTo, raEndFrom, raEndTo]);

  // 7. Scrolling is managed natively by the browser's layout engine

  // 8. Export Data Exporters
  const getCSVData = () => {
    const headers = visibleColumns.map((c) => c.header).join(",");
    const rows = processedRecords.map((rec) => {
      return visibleColumns
        .map((col) => {
          let val: any;
          if (col.accessor === "rawMaterials") {
            const activeRates = [
              { label: "Alu", price: rec.aluminiumPrice },
              { label: "Al Alloy", price: rec.aluminiumAlloyPrice },
              { label: "Cu", price: rec.copperTapePrice },
              { label: "Semicon", price: rec.extrudedSemiconductivePrice },
              { label: "XLPE", price: rec.htXlpePrice },
              { label: "ST-2", price: rec.pvcTypeSt2Price },
              { label: "Steel", price: rec.galvanisedSteelFlatStripPrice },
              { label: "Filler", price: rec.fillerPrice },
            ].filter(
              (m) => m.price !== null && m.price !== undefined && m.price !== 0,
            );
            val = activeRates.map((m) => `${m.label}: ₹${m.price}`).join(" | ");
          } else if (col.accessor === "itemSchedules") {
            val = (rec.itemSchedules ?? []).join(" | ");
          } else if (col.accessor === "proposedErpItemName" || col.accessor === "proposedErpQuantity" || col.accessor === "cva") {
            val = parseListValue(rec[col.accessor as keyof EpcTenderRecord] as string | undefined);
          } else {
            val = rec[col.accessor as keyof EpcTenderRecord];
          }
          if (val === null || val === undefined) return "";
          if (val instanceof Date) return formatDateISTShort(val);

          // Escape quotes
          let strVal = String(val);
          if (
            strVal.includes(",") ||
            strVal.includes('"') ||
            strVal.includes("\n")
          ) {
            strVal = `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        })
        .join(",");
    });
    return [headers, ...rows].join("\n");
  };

  const handleExportCSV = () => {
    const csvContent = getCSVData();
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `Tender_Participation_Data_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Without this the blob stays pinned for the lifetime of the tab.
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const exportData = processedRecords.map((rec) => {
      const obj: Record<string, string | number> = {};
      for (const col of visibleColumns) {
        let val: any;
        if (col.accessor === "rawMaterials") {
          const activeRates = [
            { label: "Al", price: rec.aluminiumPrice },
            { label: "Al Alloy", price: rec.aluminiumAlloyPrice },
            { label: "Cu", price: rec.copperTapePrice },
            { label: "Semicon", price: rec.extrudedSemiconductivePrice },
            { label: "XLPE", price: rec.htXlpePrice },
            { label: "ST-2", price: rec.pvcTypeSt2Price },
            { label: "Steel", price: rec.galvanisedSteelFlatStripPrice },
            { label: "Filler", price: rec.fillerPrice },
          ].filter(
            (m) =>
              m.price !== null && m.price !== undefined && m.price !== 0,
          );
          val = activeRates
            .map((m) => `${m.label}: ${m.price}`)
            .join(" | ");
        } else if (col.accessor === "itemSchedules") {
          val = (rec.itemSchedules ?? []).join(" | ");
        } else if (col.accessor === "proposedErpItemName" || col.accessor === "proposedErpQuantity" || col.accessor === "cva") {
          val = parseListValue(rec[col.accessor as keyof EpcTenderRecord] as string | undefined);
        } else {
          val = rec[col.accessor as keyof EpcTenderRecord];
        }
        if (val === null || val === undefined) {
          obj[col.header] = "";
        } else if (val instanceof Date) {
          obj[col.header] = formatDateISTShort(val);
        } else if (col.type === "percentage") {
          obj[col.header] = `${((val as number) * 100).toFixed(1)}%`;
        } else {
          obj[col.header] = String(val);
        }
      }
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tenders");
    const date = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Tender_Participation_Data_${date}.xlsx`);
  };

  // Formatting Helper Utilities
  const formatCurrency = (val: number | null): string => {
    if (val === null) return "-";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
      val,
    );
  };

  const formatDate = (val: Date | string | number | null | undefined): string => {
    return formatDateISTShort(val as any);
  };

  const formatPercentage = (val: number | null): string => {
    if (val === null) return "-";
    const prefix = val > 0 ? "+" : "";
    return `${prefix}${(val * 100).toFixed(1)}%`;
  };

  const getStatusClass = (status: string): string => {
    if (!status) return "submitted";
    const lower = status.toLowerCase();
    if (
      lower.includes("awarded") ||
      lower.includes("won") ||
      lower.includes("l1") ||
      lower.includes("po received") ||
      lower.includes("loi received")
    ) {
      return "won";
    }
    if (
      lower.includes("not in our favour") ||
      lower.includes("lost") ||
      lower.includes("disqualified") ||
      lower.includes("l2") ||
      lower.includes("l3") ||
      lower.includes("rejected") ||
      lower.includes("not participated")
    ) {
      return "lost";
    }
    if (
      lower.includes("technical bid opened") ||
      lower.includes("financial evaluation") ||
      lower.includes("under evaluation") ||
      lower.includes("not evaluated") ||
      lower.includes("evaluation") ||
      lower.includes("date extended") ||
      lower.includes("submitted") ||
      lower.includes("tender opened")
    ) {
      return "eval";
    }
    if (
      lower.includes("ra pending") ||
      lower.includes("reverse auction") ||
      lower.includes("ra scheduled")
    ) {
      return "loi";
    }
    if (lower.includes("cancelled") || lower.includes("canceled")) {
      return "lost";
    }
    return "submitted"; // Default style
  };

  const getDecisionClass = (decision: ManagementDecision): string => {
    switch (decision) {
      case ManagementDecision.GO:
        return "go";
      case ManagementDecision.NO_GO:
        return "nogo";
      default:
        return "";
    }
  };

  return (
    <div className="tender-table-container">
      {/* 9. Header Toolbar */}
      <div className="tender-table-toolbar">
        <div className="toolbar-left">
          <h2 className="table-title">Master Tender Participation Tracker</h2>
          <span className="record-count-badge" title={`${processedRecords.length} total records`}>
            {totalRecords} {totalRecords === 1 ? "Tender" : "Tenders"}
          </span>
          <div className="global-search-container">
            <span
              className="search-icon"
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <Search size={16} />
            </span>
            <input
              type="text"
              className="global-search-input"
              placeholder="Search..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="toolbar-right">
          {sortColumn && (
            <button
              className="export-btn"
              onClick={handleClearSort}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <RotateCcw size={14} /> Clear Sort
            </button>
          )}
          <div className="column-picker-container" style={{ position: "relative" }}>
            <button
              className="export-btn"
              onClick={() => {
                setShowColumnPicker((v) => {
                  if (v) setColumnPickerSearch("");
                  return !v;
                });
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Columns3 size={14} /> Columns
            </button>
            {showColumnPicker && (
              <>
                <div
                  className="column-picker-overlay"
                  onClick={() => {
                    setShowColumnPicker(false);
                    setColumnPickerSearch("");
                  }}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                />
                <div
                  className="column-picker-dropdown column-picker-dropdown--enhanced"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    zIndex: 50,
                    width: 280,
                    background: "#fff",
                    borderRadius: 6,
                    boxShadow: "0 4px 12px rgba(10,37,64,0.15)",
                    border: "1px solid #e1e6eb",
                    padding: 8,
                    maxHeight: 400,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "rgba(0,0,0,0.5)",
                      padding: "4px 6px 8px",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      borderBottom: "1px solid #e1e6eb",
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Toggle Columns</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--color-brand-accent)",
                        textTransform: "none",
                        letterSpacing: 0,
                        background: "var(--color-brand-light)",
                        padding: "2px 6px",
                        borderRadius: 10,
                        border: "1px solid var(--color-brand-light)",
                      }}
                    >
                      {baseVisibleColumns.filter((c) => columnVisibility[c.accessor] !== false).length}/{baseVisibleColumns.length}
                    </span>
                  </p>
                  <div style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: 8 }}>
                    <Search size={14} style={{ position: "absolute", left: 8, color: "#94a3b8", pointerEvents: "none" }} />
                    <input
                      type="text"
                      placeholder="Search columns..."
                      value={columnPickerSearch}
                      onChange={(e) => setColumnPickerSearch(e.target.value)}
                      autoFocus
                      style={{
                        width: "100%",
                        padding: "6px 28px",
                        border: "1px solid #e1e6eb",
                        borderRadius: 6,
                        fontSize: 12,
                        outline: "none",
                      }}
                    />
                    {columnPickerSearch && (
                      <button
                        type="button"
                        onClick={() => setColumnPickerSearch("")}
                        style={{
                          position: "absolute",
                          right: 6,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          border: "none",
                          background: "transparent",
                          color: "#64748b",
                          cursor: "pointer",
                        }}
                        aria-label="Clear search"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const q = columnPickerSearch.trim().toLowerCase();
                        const filtered = q
                          ? baseVisibleColumns.filter(
                              (c) => c.header.toLowerCase().includes(q) || String(c.accessor).toLowerCase().includes(q),
                            )
                          : baseVisibleColumns;
                        const next = { ...columnVisibility };
                        filtered.forEach((c) => delete next[c.accessor]);
                        setColumnVisibility(next);
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "6px 8px",
                        background: "#fff",
                        border: "1px solid #e1e6eb",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <CheckCheck size={12} /> Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const q = columnPickerSearch.trim().toLowerCase();
                        const filtered = q
                          ? baseVisibleColumns.filter(
                              (c) => c.header.toLowerCase().includes(q) || String(c.accessor).toLowerCase().includes(q),
                            )
                          : baseVisibleColumns;
                        const next: Record<string, boolean> = { ...columnVisibility };
                        filtered.forEach((c) => (next[c.accessor] = false));
                        const remaining = baseVisibleColumns.filter((c) => next[c.accessor] !== false).length;
                        if (remaining === 0 && filtered.length > 0) delete next[filtered[0].accessor];
                        setColumnVisibility(next);
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "6px 8px",
                        background: "#fff",
                        border: "1px solid #e1e6eb",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <X size={12} /> Clear
                    </button>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                    {(() => {
                      const q = columnPickerSearch.trim().toLowerCase();
                      const filtered = q
                        ? baseVisibleColumns.filter(
                            (c) => c.header.toLowerCase().includes(q) || String(c.accessor).toLowerCase().includes(q),
                          )
                        : baseVisibleColumns;
                      if (filtered.length === 0) return <p style={{ textAlign: "center", padding: 16, color: "#94a3b8", fontSize: 12 }}>No columns found</p>;
                      return filtered.map((col) => (
                        <label
                          key={col.accessor}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 6px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                            color: "var(--color-brand)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={columnVisibility[col.accessor] !== false}
                            onChange={() =>
                              setColumnVisibility((prev) => ({
                                ...prev,
                                [col.accessor]: !(prev[col.accessor] ?? true),
                              }))
                            }
                            style={{ width: 14, height: 14, accentColor: "var(--color-brand-accent)" }}
                          />
                          {col.header}
                        </label>
                      ));
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            className="export-btn"
            onClick={handleExportCSV}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            className="export-btn"
            onClick={handleExportExcel}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <FileSpreadsheet size={14} /> Export Excel
          </button>
        </div>
      </div>

      {/* 10. Data Table Grid */}
      <div className="tender-table-wrapper" ref={scrollContainerRef}>
        <table className="tender-data-table">
          <thead>
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.accessor}
                  className={col.sticky ? "sticky-col" : undefined}
                  style={{
                    width: `${columnWidths[col.accessor]}px`,
                    ...(col.sticky ? { left: stickyLeftOffsets[col.accessor] } : {}),
                    ...(openDropdown === col.accessor
                      ? { zIndex: 100 }
                      : {}),
                  }}
                >
                    <div
                      className="header-content"
                      onClick={() => handleSort(col.accessor)}
                    >
                      <span>{col.header}</span>
                      {sortColumn === col.accessor && (
                        <span
                          className="sort-indicator"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          {sortDirection === "asc" ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                        </span>
                      )}
                    </div>
                    {col.accessor === "lastDateOfSubmission" && (
                      <div
                        className="column-deadline-filter"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Select
                          value={datePreset}
                          onValueChange={(v) => {
                            setDatePreset((v ?? "") as "" | "thisWeek" | "thisMonth" | "thisYear");
                            setStartDate("");
                            setEndDate("");
                            setCurrentPage(1);
                          }}
                        >
                          <SelectTrigger size="sm" className="deadline-preset-select w-full">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">All</SelectItem>
                            <SelectItem value="thisWeek">This Week</SelectItem>
                            <SelectItem value="thisMonth">This Month</SelectItem>
                            <SelectItem value="thisYear">This Year</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="deadline-date-range-row">
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="date-range-trigger-btn"
                                  title="Filter by Last Date of Submission range"
                                >
                                  <CalendarIcon size={12} />
                                  {dateRangeLabel}
                                </button>
                              }
                            />
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="range"
                                defaultMonth={
                                  activeDateRange?.from ?? new Date()
                                }
                                selected={activeDateRange}
                                onSelect={handleDateRangeSelect}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                          {(startDate || endDate || datePreset) && (
                            <button
                              className="date-filter-clear-btn"
                              onClick={() => {
                                setStartDate("");
                                setEndDate("");
                                setDatePreset("");
                                setCurrentPage(1);
                              }}
                              title="Clear date filter"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {col.accessor === "reverseAuctionStartDate" && (
                      <div
                        className="column-ra-filter"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div className="deadline-date-range-row">
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="date-range-trigger-btn"
                                  title="Filter by RA start date range"
                                >
                                  <CalendarIcon size={12} />
                                  Start: {formatRangeLabel(raStartFrom, raStartTo)}
                                </button>
                              }
                            />
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="range"
                                defaultMonth={
                                  raStartActiveRange?.from ?? new Date()
                                }
                                selected={raStartActiveRange}
                                onSelect={handleRaStartSelect}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                          {(raStartFrom || raStartTo) && (
                            <button
                              className="date-filter-clear-btn"
                              onClick={() => {
                                setRaStartFrom("");
                                setRaStartTo("");
                                setCurrentPage(1);
                              }}
                              title="Clear RA start date filter"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                        <div className="deadline-date-range-row">
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="date-range-trigger-btn"
                                  title="Filter by RA end date range"
                                >
                                  <CalendarIcon size={12} />
                                  End: {formatRangeLabel(raEndFrom, raEndTo)}
                                </button>
                              }
                            />
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="range"
                                defaultMonth={
                                  raEndActiveRange?.from ?? new Date()
                                }
                                selected={raEndActiveRange}
                                onSelect={handleRaEndSelect}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                          {(raEndFrom || raEndTo) && (
                            <button
                              className="date-filter-clear-btn"
                              onClick={() => {
                                setRaEndFrom("");
                                setRaEndTo("");
                                setCurrentPage(1);
                              }}
                              title="Clear RA end date filter"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {col.accessor === "tenderUpdateStatus" && (
                      <div
                        className="custom-multiselect-container"
                        ref={(el) => {
                          dropdownRefs.current[col.accessor] = el;
                        }}
                      >
                        <button
                          className="multiselect-trigger-btn"
                          onClick={() =>
                            setOpenDropdown(
                              openDropdown === col.accessor ? null : col.accessor,
                            )
                          }
                        >
                          {(!multiSelectFilters[col.accessor] ||
                            multiSelectFilters[col.accessor].length === 0)
                            ? `All ${col.header}`
                            : `${multiSelectFilters[col.accessor].length} Selected`}
                          <span
                            className="dropdown-arrow"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <ChevronDown size={12} />
                          </span>
                        </button>
                        {openDropdown === col.accessor && (
                          <div className="multiselect-dropdown-panel">
                            <div className="multiselect-actions">
                              <button
                                className="multiselect-action-btn"
                                onClick={() => clearFilter(col.accessor)}
                              >
                                Clear All
                              </button>
                              <button
                                className="multiselect-action-btn"
                                onClick={() => {
                                  setMultiSelectFilters((prev) => ({
                                    ...prev,
                                    [col.accessor]: tenderStatusOptions
                                      .map(([code]) => code)
                                      .concat("(Blank)"),
                                  }));
                                  setCurrentPage(1);
                                }}
                              >
                                Select All
                              </button>
                            </div>
                            <div className="multiselect-options-list">
                              {tenderStatusOptions.map(([code, label]) => (
                                  <label
                                    key={code}
                                    className="multiselect-option-label"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        multiSelectFilters[col.accessor]?.includes(
                                          code,
                                        ) ?? false
                                      }
                                      onChange={() =>
                                        toggleFilter(col.accessor, code)
                                      }
                                    />
                                    <span>{label}</span>
                                  </label>
                                ),
                              )}
                              <label className="multiselect-option-label">
                                <input
                                  type="checkbox"
                                  checked={
                                    multiSelectFilters[col.accessor]?.includes(
                                      "(Blank)",
                                    ) ?? false
                                  }
                                  onChange={() =>
                                    toggleFilter(col.accessor, "(Blank)")
                                  }
                                />
                                <span>(Blank)</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {col.accessor === "nextAction" && (
                      <div
                        className="custom-multiselect-container"
                        ref={(el) => {
                          dropdownRefs.current[col.accessor] = el;
                        }}
                      >
                        <button
                          className="multiselect-trigger-btn"
                          onClick={() =>
                            setOpenDropdown(
                              openDropdown === col.accessor ? null : col.accessor,
                            )
                          }
                        >
                          {(!multiSelectFilters[col.accessor] ||
                            multiSelectFilters[col.accessor].length === 0)
                            ? `All ${col.header}`
                            : `${multiSelectFilters[col.accessor].length} Selected`}
                          <span
                            className="dropdown-arrow"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <ChevronDown size={12} />
                          </span>
                        </button>
                        {openDropdown === col.accessor && (
                          <div className="multiselect-dropdown-panel">
                            <div className="multiselect-actions">
                              <button
                                className="multiselect-action-btn"
                                onClick={() => clearFilter(col.accessor)}
                              >
                                Clear All
                              </button>
                              <button
                                className="multiselect-action-btn"
                                onClick={() => {
                                  setMultiSelectFilters((prev) => ({
                                    ...prev,
                                    [col.accessor]: nextActionOptions
                                      .map(([code]) => code)
                                      .concat("(Blank)"),
                                  }));
                                  setCurrentPage(1);
                                }}
                              >
                                Select All
                              </button>
                            </div>
                            <div className="multiselect-options-list">
                              {nextActionOptions.map(([code, label]) => (
                                  <label
                                    key={code}
                                    className="multiselect-option-label"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        multiSelectFilters[col.accessor]?.includes(
                                          code,
                                        ) ?? false
                                      }
                                      onChange={() =>
                                        toggleFilter(col.accessor, code)
                                      }
                                    />
                                    <span>{label}</span>
                                  </label>
                                ),
                              )}
                              <label className="multiselect-option-label">
                                <input
                                  type="checkbox"
                                  checked={
                                    multiSelectFilters[col.accessor]?.includes(
                                      "(Blank)",
                                    ) ?? false
                                  }
                                  onChange={() =>
                                    toggleFilter(col.accessor, "(Blank)")
                                  }
                                />
                                <span>(Blank)</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {!SKIP_FILTER_COLUMNS.has(col.accessor) && (
                      <div
                        className="custom-multiselect-container"
                        ref={(el) => {
                          dropdownRefs.current[col.accessor] = el;
                        }}
                      >
                        <button
                          className="multiselect-trigger-btn"
                          onClick={() =>
                            setOpenDropdown(
                              openDropdown === col.accessor ? null : col.accessor,
                            )
                          }
                        >
                          {(!multiSelectFilters[col.accessor] ||
                            multiSelectFilters[col.accessor].length === 0)
                            ? `All ${col.header}`
                            : `${multiSelectFilters[col.accessor].length} Selected`}
                          <span
                            className="dropdown-arrow"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <ChevronDown size={12} />
                          </span>
                        </button>
                        {openDropdown === col.accessor && (
                          <div className="multiselect-dropdown-panel">
                            <div className="multiselect-actions">
                              <button
                                className="multiselect-action-btn"
                                onClick={() => clearFilter(col.accessor)}
                              >
                                Clear All
                              </button>
                              <button
                                className="multiselect-action-btn"
                                onClick={() => selectAllFilter(col.accessor)}
                              >
                                Select All
                              </button>
                            </div>
                            <div className="multiselect-options-list">
                              {BOOLEAN_COLUMNS.has(col.accessor) ? (
                                <>
                                  {["Yes", "No"].map((opt) => (
                                    <label
                                      key={opt}
                                      className="multiselect-option-label"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={
                                          multiSelectFilters[col.accessor]?.includes(
                                            opt,
                                          ) ?? false
                                        }
                                        onChange={() =>
                                          toggleFilter(col.accessor, opt)
                                        }
                                      />
                                      <span>{opt}</span>
                                    </label>
                                  ))}
                                </>
                              ) : (
                                (uniqueValueCache[col.accessor] ?? []).map(
                                  (val) => (
                                    <label
                                      key={val}
                                      className="multiselect-option-label"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={
                                          multiSelectFilters[col.accessor]?.includes(
                                            val,
                                          ) ?? false
                                        }
                                        onChange={() =>
                                          toggleFilter(col.accessor, val)
                                        }
                                      />
                                      <span>{val}</span>
                                    </label>
                                  ),
                                )
                              )}
                              <label className="multiselect-option-label">
                                <input
                                  type="checkbox"
                                  checked={
                                    multiSelectFilters[col.accessor]?.includes(
                                      "(Blank)",
                                    ) ?? false
                                  }
                                  onChange={() =>
                                    toggleFilter(col.accessor, "(Blank)")
                                  }
                                />
                                <span>(Blank)</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {col.accessor !== "lastDateOfSubmission" && col.accessor !== "rawMaterials" && col.accessor !== "proposedErpItemName" && col.accessor !== "remarks" &&  (
                      <input
                        type="text"
                        className="column-search-input"
                        placeholder={`Search ${col.header}...`}
                        value={columnSearchText[col.accessor] ?? ""}
                        onChange={(e) => {
                          setColumnSearchText((prev) => ({
                            ...prev,
                            [col.accessor]: e.target.value,
                          }));
                          setCurrentPage(1);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}
                    {col.accessor === "proposedErpItemName" && (
                      <div
                        className="column-remarks-filter"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{ marginTop: "4px" }}
                      >
                        <input
                          type="text"
                          className="remarks-search-input"
                          placeholder="Search items..."
                          value={proposedErpItemTextFilter}
                          onChange={(e) => {
                            setProposedErpItemTextFilter(e.target.value);
                            setCurrentPage(1);
                          }}
                        />
                        <Select
                          value={proposedErpItemCategoryFilter}
                          onValueChange={(v) => {
                            setProposedErpItemCategoryFilter(v ?? "All");
                            setCurrentPage(1);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="remarks-filter-select w-full"
                            style={{ marginTop: "4px" }}
                          >
                            <SelectValue placeholder="All Categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="All">All Categories</SelectItem>
                            <SelectItem value="AB Cable">AB Cable</SelectItem>
                            <SelectItem value="Conductor">Conductor</SelectItem>
                            <SelectItem value="XLPE Cable">XLPE Cable</SelectItem>
                            <SelectItem value="PVC Cable">PVC Cable</SelectItem>
                            <SelectItem value="Control Cable">Control Cable</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {col.accessor === "rawMaterials" &&
                      setAluminiumMin &&
                      setAluminiumMax &&
                      setCopperMin &&
                      setCopperMax && (
                        <div
                          className="column-raw-materials-filter"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <div className="filter-row">
                            <span className="filter-row-label">Alu:</span>
                            <input
                              type="number"
                              placeholder="Min"
                              className="col-price-filter-input"
                              value={aluminiumMin || ""}
                              onChange={(e) => setAluminiumMin(e.target.value)}
                              title="Aluminium Min"
                            />
                            <span className="filter-row-dash">-</span>
                            <input
                              type="number"
                              placeholder="Max"
                              className="col-price-filter-input"
                              value={aluminiumMax || ""}
                              onChange={(e) => setAluminiumMax(e.target.value)}
                              title="Aluminium Max"
                            />
                          </div>
                          <div
                            className="filter-row"
                            style={{ marginTop: "4px" }}
                          >
                            <span className="filter-row-label">Cu:</span>
                            <input
                              type="number"
                              placeholder="Min"
                              className="col-price-filter-input"
                              value={copperMin || ""}
                              onChange={(e) => setCopperMin(e.target.value)}
                              title="Copper Min"
                            />
                            <span className="filter-row-dash">-</span>
                            <input
                              type="number"
                              placeholder="Max"
                              className="col-price-filter-input"
                              value={copperMax || ""}
                              onChange={(e) => setCopperMax(e.target.value)}
                              title="Copper Max"
                            />
                          </div>
                        </div>
                      )}
                    {col.accessor === "remarks" && (
                      <div
                        className="column-remarks-filter"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{ marginTop: "4px" }}
                      >
                        <input
                          type="text"
                          className="remarks-search-input"
                          placeholder="Search remarks..."
                          value={remarksTextFilter}
                          onChange={(e) => {
                            setRemarksTextFilter(e.target.value);
                            setCurrentPage(1);
                          }}
                        />
                        <Select
                          value={remarksDropdownFilter}
                          onValueChange={(v) => {
                            setRemarksDropdownFilter(v ?? "All");
                            setCurrentPage(1);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="remarks-filter-select w-full"
                            style={{ marginTop: "4px" }}
                          >
                            <SelectValue placeholder="All Remarks" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="All">All Remarks</SelectItem>
                            {uniqueRemarks.map((rem) => (
                              <SelectItem key={rem} value={rem}>
                                {rem}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div
                      className="column-resizer"
                      onMouseDown={(e) =>
                        handleResizeStart(
                          e,
                          col.accessor,
                          columnWidths[col.accessor],
                        )
                      }
                    />
                  </th>
                ))
              }
            </tr>
          </thead>
          <tbody>
            {paginatedGroups.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "rgba(0,0,0,0.4)",
                  }}
                >
                  No matching records found.
                </td>
              </tr>
            ) : (
              paginatedGroups.map((group) => group.records.map((record, rowIdx) => (
                <tr key={record.id ?? record.slNo} className="tender-row">
                  {visibleColumns.map((col) => {
                        if (col.accessor === "docketNo" && rowIdx > 0) return null;

                        let cellVal: any;
                        let cellContent: React.ReactNode = "-";
                        let cellClass = "";

                        const editableCfg = EDITABLE_FIELDS[col.accessor];
                        if (editableCfg) {
                          const isEditing =
                            editingCell?.id === record.id &&
                            editingCell?.accessor === col.accessor;
                          const isSaving =
                            !!savingKeys[`${record.id}-${col.accessor}`];
                          if (isEditing) {
                            cellContent = (
                              <InlineEditor
                                initialValue={editableCfg.toDraft(record)}
                                kind={editableCfg.kind}
                                saving={isSaving}
                                onSave={(draft) =>
                                  saveCell(record, col.accessor, draft)
                                }
                                onCancel={() => setEditingCell(null)}
                              />
                            );
                          } else {
                            const rawDisplay = editableCfg.display(record);
                            const moneyCols = new Set(["ourValue", "valueOfRank1", "valueOfRank2"]);
                            const displayVal = variant === "party" && moneyCols.has(col.accessor) ? formatMoney(rawDisplay) : rawDisplay;
                            cellContent = (
                              <div className="flex flex-col items-start gap-1">
                                <span className="docket-display">
                                  {displayVal}
                                  {isSaving && (
                                    <Loader2
                                      size={12}
                                      className="spin"
                                      style={{ marginLeft: 4 }}
                                    />
                                  )}
                                </span>
                                {col.accessor === "docketNo" && rowIdx === 0 && group.records.length > 0 && (
                                  <button
                                    className="flex-shrink-0 h-6 px-2 rounded flex items-center gap-1 border border-brand-light bg-brand-light hover:bg-brand-light text-brand text-[11px] font-medium transition-colors"
                                    title={`View tender details (${group.records.length} record${group.records.length !== 1 ? "s" : ""})`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDetailRecords(group.records);
                                    }}
                                  >
                                    <Eye size={12} /> View
                                  </button>
                                )}
                              </div>
                            );
                          }
                          const editable = editableCfg.canEdit(
                            record,
                            readOnly,
                            editableColumns,
                          );
                          cellClass = editable
                            ? editableCfg.editableClass
                            : (editableCfg.readOnlyClass ??
                              editableCfg.editableClass);
                          cellClass += editableCfg.displayClass?.(record) ?? "";
                        } else if (col.accessor === "merged_office_consignees") {
                          const office = record.officeName || "";
                          const consignees = record.consigneesReportingOfficer || "";
                          cellContent = (
                            <div className="relative group/cell h-full">
                              <div className="flex flex-col leading-tight" style={{ minHeight: 30 }}>
                                <span className="text-xs font-medium">{office || "-"}</span>
                                {consignees && <span className="text-[11px] text-slate-500">{consignees}</span>}
                              </div>
                              <button
                                className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
                                title="Edit Office Name @ Consignees"
                                onClick={(e) => { e.stopPropagation(); setOfficeDialogRecord(record); }}
                              >
                                <Pencil className="w-4 h-4 text-white" />
                              </button>
                            </div>
                          );
                          cellClass = "col-left";
                        } else if (col.accessor === "website") {
                          const websiteVal = record.website || "";
                          const websiteKey = `${record.id}-website`;
                          const isSaving = !!updatingCells[websiteKey];
                          const urls = websiteVal
                            ? websiteVal.split(",").map((s: string) => s.trim()).filter(Boolean)
                            : [];
                          cellContent = (
                            <div className="relative group/cell h-full">
                              <div className="h-full" style={{ height: 70, maxHeight: 70, overflowY: "auto", whiteSpace: "normal" }}>
                                {urls.length > 0 ? (
                                  <div className="flex flex-col gap-1">
                                    {urls.map((url: string, i: number) => (
                                      <a
                                        key={i}
                                        href={url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`}
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
                                  <span className="text-slate-300">-</span>
                                )}
                              </div>
                              <button
                                className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
                                title="Edit Website"
                                onClick={(e) => { e.stopPropagation(); setWebsiteDialogRecord(record); }}
                              >
                                {isSaving ? (
                                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                                ) : (
                                  <Pencil className="w-4 h-4 text-white" />
                                )}
                              </button>
                            </div>
                          );
                          cellClass = "col-left";
                        } else if (col.accessor === "rawMaterials") {
                          const raw = (record as any).rawMaterials;
                          let entries: [string, unknown][] = [];
                          if (raw != null && raw !== "") {
                            if (typeof raw === "object") {
                              entries = Object.entries(raw);
                            } else {
                              try {
                                const parsed = JSON.parse(String(raw));
                                if (typeof parsed === "object" && parsed !== null) {
                                  entries = Object.entries(parsed);
                                }
                              } catch {}
                            }
                          }
                          const nonNull = entries.filter(
                            ([, v]) => v !== null && v !== undefined && String(v) !== "",
                          );
                          cellContent = nonNull.length > 0 ? (
                            <div
                              className="raw-materials-scroll-cell"
                              title={nonNull
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(" | ")}
                            >
                              <div className="raw-materials-grid">
                                {nonNull.map(([key, val], i) => (
                                  <div
                                    className="material-rate-tag"
                                    key={i}
                                    title={`${key}: ${String(val)}`}
                                  >
                                    <span className="mat-lbl">{key}:</span>
                                    <span className="mat-val">{String(val)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span>-</span>
                          );
                          cellClass = "col-left";
                        } else if (col.accessor === "files") {
                          cellContent = (
                            <FilesCell
                              tenderFilesJson={record.tenderFiles || ""}
                              onOpenModal={handleOpenAttachmentModal}
                            />
                          );
                          cellClass = "col-center";
                        } else if (col.accessor === "boqChart") {
                          cellContent = (
                            <BOQChartCell docketNo={record.docketNo} boqFileId={record.boqFileId} tenderFilesJson={record.tenderFiles} />
                          );
                          cellClass = "col-center";
                        } else if ((col.accessor as string) === "typeTests" || (col.accessor as string) === "typetest") {
                          const rawTT = (record as any).typeTests ?? (record as any).typetest ?? "";
                          let ttList: Array<{ itemCode: string; testCertificateNo: string; testCertificateUrl: string | null }> = [];
                          try {
                            const parsed = JSON.parse(rawTT || "[]");
                            if (Array.isArray(parsed)) ttList = parsed;
                          } catch {}
                          if (ttList.length === 0) {
                            cellContent = <span>-</span>;
                          } else {
                            cellContent = (
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: 140, overflowY: "auto" }}>
                                {ttList.map((tt, i) => (
                                  <div key={i} style={{ fontSize: "11px", lineHeight: "14px", whiteSpace: "nowrap" }}>
                                    {tt.itemCode} -{" "}
                                    {tt.testCertificateUrl ? (
                                      <a
                                        href={`/api/executive-files/view/${tt.testCertificateUrl}?auth=${encodeURIComponent("Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE")}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: "var(--color-brand-accent)", textDecoration: "underline" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {tt.testCertificateNo}
                                      </a>
                                    ) : (
                                      <span>{tt.testCertificateNo}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          cellClass = "col-left";
                        } else if (col.accessor === "proposedErpItemName") {
                          // Prefer full CostingSheetDetails rows (with id/bomType/bomCode) for card rendering; fallback to string parts
                          type CostingRow = { id: number; proposedErpItemName: string | null; bomType?: string | null; bomCode?: string | null };
                          let costingRows: CostingRow[] = [];
                          try {
                            const rawCosting = (record as any).costingDetails as string | undefined;
                            if (rawCosting) {
                              const parsed = JSON.parse(rawCosting);
                              if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
                                costingRows = parsed
                                  .map((c: any) => ({
                                    id: Number(c.id),
                                    proposedErpItemName: c.proposedErpItemName ?? null,
                                    bomType: c.bomType ?? null,
                                    bomCode: c.bomCode ?? null,
                                  }))
                                  .filter((r: CostingRow) => r.proposedErpItemName && String(r.proposedErpItemName).trim() !== "");
                              }
                            }
                          } catch {}
                          // fallback to legacy string list if costingDetails missing
                          if (costingRows.length === 0) {
                            const raw: unknown = record[col.accessor as keyof EpcTenderRecord];
                            let parts: string[] = [];
                            if (raw != null && raw !== "") {
                              if (typeof raw === "object" && !(raw instanceof Date)) {
                                if (Array.isArray(raw)) parts = (raw as any[]).map(String);
                                else parts = Object.keys(raw as Record<string, unknown>).map(String);
                              } else if (typeof raw === "string") {
                                try {
                                  const parsed = JSON.parse(raw);
                                  if (Array.isArray(parsed)) parts = parsed.map(String);
                                  else if (typeof parsed === "object" && parsed !== null) parts = Object.keys(parsed as Record<string, unknown>).map(String);
                                } catch {
                                  parts = raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
                                }
                              }
                            }
                            costingRows = parts.map((p, idx) => ({ id: -idx - 1, proposedErpItemName: p, bomType: null, bomCode: null }));
                          }
                          if (costingRows.length === 0) {
                            cellContent = <span>-</span>;
                            cellClass = "col-left";
                          } else {
                            cellContent = (
                              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 220 }}>
                                {costingRows.map((row) => {
                                  const costingId = row.id;
                                  const isPlaceholder = costingId < 0;
                                  const itemName = String(row.proposedErpItemName ?? "").trim();
                                  const override = costingOverrides[String(costingId)] ?? {};
                                  const displayBomType = (override.bomType !== undefined ? override.bomType : row.bomType) ?? "";
                                  const displayBomCode = (override.bomCode !== undefined ? override.bomCode : row.bomCode) ?? "";
                                  const bomOptions: Array<{ bomType: string | null; bomId: string }> = (bomByItemName[itemName] ?? bomByItemName[itemName?.trim()] ?? []) as any;
                                  // also fallback case-insensitive lookup
                                  let opts = bomOptions;
                                  if ((!opts || opts.length === 0) && itemName) {
                                    const lower = itemName.toLowerCase();
                                    for (const [k, v] of Object.entries(bomByItemName as Record<string, any[]>)) {
                                      if (k.toLowerCase() === lower) { opts = v as any; break; }
                                    }
                                  }
                                  const typeOptions = Array.from(new Set(opts.map((o) => (o.bomType ?? "").trim()).filter(Boolean))).sort();
                                  const filteredBomIds = displayBomType
                                    ? opts.filter((o) => (o.bomType ?? "").trim() === displayBomType).map((o) => o.bomId)
                                    : opts.map((o) => o.bomId);
                                  const uniqueBomIds = Array.from(new Set(filteredBomIds.filter(Boolean))).sort();
                                  const isSavingType = !!savingBom[`${costingId}-bomType`];
                                  const isSavingCode = !!savingBom[`${costingId}-bomCode`];
                                  return (
                                    <div key={costingId} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: "#1e293b", lineHeight: "1.3", wordBreak: "break-word" }}>{itemName || "-"}</div>
                                      <div style={{ display: "flex", gap: 6 }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2, fontWeight: 600 }}>BOM Type</div>
                                          <Select
                                            value={displayBomType}
                                            disabled={isPlaceholder || utilityLoading || isSavingType}
                                            onValueChange={(v) => {
                                              if (isPlaceholder) return;
                                              handleCostingBomUpdate(costingId, "bomType", v ?? "", itemName, row.bomType ?? null, row.bomCode ?? null);
                                            }}
                                          >
                                            <SelectTrigger size="sm" className="w-full h-7 text-[11px] bg-white">
                                              <SelectValue placeholder={utilityLoading ? "Loading..." : "Select type"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="">(Blank)</SelectItem>
                                              {typeOptions.map((t) => (
                                                <SelectItem key={t} value={t}>{t || "(Blank)"}</SelectItem>
                                              ))}
                                              {typeOptions.length === 0 && !utilityLoading && <SelectItem value="__no_options" disabled>No options</SelectItem>}
                                            </SelectContent>
                                          </Select>
                                          {isSavingType && <span style={{ fontSize: 9, color: "#64748b" }}>Saving...</span>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2, fontWeight: 600 }}>BOM Code</div>
                                          <Select
                                            value={displayBomCode}
                                            disabled={isPlaceholder || isSavingCode || (!displayBomType && uniqueBomIds.length === 0)}
                                            onValueChange={(v) => {
                                              if (isPlaceholder) return;
                                              handleCostingBomUpdate(costingId, "bomCode", v ?? "", itemName, row.bomType ?? null, row.bomCode ?? null);
                                            }}
                                          >
                                            <SelectTrigger size="sm" className="w-full h-7 text-[11px] bg-white">
                                              <SelectValue placeholder={displayBomType ? "Select code" : "Select type first"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="">(Blank)</SelectItem>
                                              {uniqueBomIds.map((code) => (
                                                <SelectItem key={code} value={code}>{code}</SelectItem>
                                              ))}
                                              {uniqueBomIds.length === 0 && <SelectItem value="__no_options" disabled>{displayBomType ? "No codes for type" : "No codes"}</SelectItem>}
                                            </SelectContent>
                                          </Select>
                                          {isSavingCode && <span style={{ fontSize: 9, color: "#64748b" }}>Saving...</span>}
                                        </div>
                                      </div>
                                      {isPlaceholder && <span style={{ fontSize: 9, color: "#ef4444" }}>No CostingSheetDetails ID — cannot save</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                            cellClass = "col-left";
                          }
                        } else if (col.accessor === "proposedErpQuantity") {
                          const raw: unknown = record[col.accessor as keyof EpcTenderRecord];
                          let parts: string[] = [];
                          if (raw != null && raw !== "") {
                            if (typeof raw === "object" && !(raw instanceof Date)) {
                              if (Array.isArray(raw)) {
                                parts = (raw as any[]).map(String);
                              } else {
                                parts = Object.values(raw as Record<string, unknown>).map(String);
                              }
                            } else if (typeof raw === "string") {
                              try {
                                const parsed = JSON.parse(raw);
                                if (Array.isArray(parsed)) {
                                  parts = parsed.map(String);
                                } else if (typeof parsed === "object" && parsed !== null) {
                                  parts = Object.values(parsed).map(String);
                                }
                              } catch {
                                parts = raw.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
                              }
                            }
                          }
                          cellContent = parts.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {parts.map((part, i) => <div key={i} style={{ background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>{part}</div>)}
                            </div>
                          ) : (
                            <span>-</span>
                          );
                          cellClass = "col-left";
                        } else if (col.accessor === "itemSchedules") {
                          const raw: unknown = record.itemSchedules;
                          let schedules: string[] = [];
                          if (Array.isArray(raw)) {
                            schedules = raw.map(String);
                          } else if (typeof raw === "string" && raw.trim() !== "") {
                            try {
                              const parsed = JSON.parse(raw);
                              schedules = Array.isArray(parsed) ? parsed.map(String) : [];
                            } catch {
                              schedules = raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
                            }
                          }
                          schedules = Array.from(new Set(schedules.filter((s) => s.trim() !== "")));
                          cellContent = schedules.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {schedules.map((schedule, i) => <div key={i} style={{ background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>{schedule}</div>)}
                            </div>
                          ) : (
                            <span>-</span>
                          );
                          cellClass = "col-left";
                        } else if (col.accessor === "tenderUpdateStatus") {
                          const statusValue =
                            overrides[record.id!]?.tenderUpdateStatus ??
                            record.tenderUpdateStatus ??
                            "OPEN";
                          const isSaving =
                            !!savingKeys[`${record.id}::tenderUpdateStatus`];
                          if (readOnly && !editableColumns.includes("tenderUpdateStatus")) {
                            cellContent = (
                              <span className={`status-badge ${statusValue === "CLOSED" ? "won" : "eval"}`}>
                                {statusValue}
                              </span>
                            );
                            cellClass = "col-center";
                          } else {
                            cellContent = (
                              <Select
                                value={statusValue}
                                disabled={isSaving}
                                onValueChange={(v) =>
                                  handleUpdate(
                                    record,
                                    "tenderUpdateStatus",
                                    v ?? "",
                                  )
                                }
                              >
                                <SelectTrigger size="sm" className="table-editable-select status-select w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="OPEN">Open</SelectItem>
                                  <SelectItem value="CLOSED">Closed</SelectItem>
                                </SelectContent>
                              </Select>
                            );
                            cellClass = "col-center col-editable";
                          }
                        } else if (col.accessor === "nextAction") {
                          const actionValue =
                            overrides[record.id!]?.nextAction !== undefined
                              ? overrides[record.id!]?.nextAction
                              : (record.nextAction ?? "");
                          const isSaving =
                            !!savingKeys[`${record.id}::nextAction`];
                          if (readOnly && !editableColumns.includes("nextAction")) {
                            const actionLabels: Record<string, string> = {
                              "UPDATE_FROM_AB_LETTER": "Update from AB letter",
                              "BG_REFUND_LETTER_TO_BE_SENT": "BG refund letter to be sent",
                              "FOLLOW_UP_FOR_FINANCIAL_STATUS": "Follow up for financial status",
                              "REVERSE_AUCTION_PENDING": "Reverse auction pending",
                              "COUNTER_OFFER_YES": "Counter Offer Yes",
                              "COUNTER_OFFER_NO": "Counter Offer No",
                            };
                            cellContent = (
                              <span>{actionValue ? actionLabels[actionValue] || actionValue : "-"}</span>
                            );
                            cellClass = "col-left";
                          } else {
                            cellContent = (
                              <Select
                                value={actionValue || ""}
                                disabled={isSaving}
                                onValueChange={(v) =>
                                  handleUpdate(
                                    record,
                                    "nextAction",
                                    v || null,
                                  )
                                }
                              >
                                <SelectTrigger size="sm" className="table-editable-select action-select w-full">
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  <SelectItem value="UPDATE_FROM_AB_LETTER">
                                    Update from AB letter
                                  </SelectItem>
                                  <SelectItem value="BG_REFUND_LETTER_TO_BE_SENT">
                                    BG refund letter to be sent
                                  </SelectItem>
                                  <SelectItem value="FOLLOW_UP_FOR_FINANCIAL_STATUS">
                                    Follow up for financial status
                                  </SelectItem>
                                  <SelectItem value="REVERSE_AUCTION_PENDING">
                                    Reverse auction pending
                                  </SelectItem>
                                  <SelectItem value="COUNTER_OFFER_YES">
                                    Counter Offer Yes
                                  </SelectItem>
                                  <SelectItem value="COUNTER_OFFER_NO">
                                    Counter Offer No
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            );
                            cellClass = "col-left col-editable";
                          }
                        } else if (col.accessor === "reverseAuctionStartDate") {
                          const raStartDate = record.reverseAuctionStartDate;
                          const raStartValid =
                            raStartDate && !isNaN(raStartDate.getTime())
                              ? raStartDate
                              : null;
                          const raStartDisplay = raStartValid
                            ? formatDateTimeIST(raStartValid)
                            : "";
                          const raEndDate = record.reverseAuctionEndDate;
                          const raEndValid =
                            raEndDate && !isNaN(raEndDate.getTime())
                              ? raEndDate
                              : null;
                          const raEndDisplay = raEndValid
                            ? formatDateTimeIST(raEndValid)
                            : "";

                          const saveRaDate = (
                            field:
                              | "reverseAuctionStartDate"
                              | "reverseAuctionEndDate",
                            value: string,
                            currentDisplay: string,
                          ) => {
                            const trimmed = value.trim();
                            if (trimmed === currentDisplay) return;
                            if (!record.id) return;
                            let isoValue = "";
                            if (trimmed !== "") {
                              const parsed = parseDate(trimmed);
                              if (!parsed) {
                                toast.error(`Invalid date: "${trimmed}"`);
                                return;
                              }
                              isoValue = format(
                                parsed,
                                "yyyy-MM-dd'T'HH:mm:ss",
                              );
                            }
                            const raWebhookData = buildRaWebhookData(record);
                            if (field === "reverseAuctionStartDate") {
                              raWebhookData.reverseAuctionStartDate =
                                isoValue || null;
                            } else {
                              raWebhookData.reverseAuctionEndDate =
                                isoValue || null;
                            }
                            handleMergedFieldSave(
                              record,
                              field,
                              isoValue,
                              () => {},
                              () => {},
                              () => {
                                dispatch(
                                  triggerReverseAuctionWebhook(raWebhookData),
                                );
                              },
                            );
                          };

                          if (
                            readOnly &&
                            !editableColumns.includes(
                              "reverseAuctionStartDate",
                            )
                          ) {
                            cellContent = (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 2,
                                }}
                              >
                                <span style={{ fontSize: 11 }}>
                                  {raStartValid
                                    ? `Start: ${formatDate(raStartValid)}`
                                    : "Start: -"}
                                </span>
                                <span style={{ fontSize: 11 }}>
                                  {raEndValid
                                    ? `End: ${formatDate(raEndValid)}`
                                    : "End: -"}
                                </span>
                              </div>
                            );
                            cellClass = "col-center";
                          } else {
                            const startSaving =
                              !!savingKeys[
                                `${record.id}-reverseAuctionStartDate`
                              ];
                            const endSaving =
                              !!savingKeys[
                                `${record.id}-reverseAuctionEndDate`
                              ];
                            cellContent = (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                  padding: "4px 0",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#5f6368",
                                      width: 30,
                                      textAlign: "right",
                                    }}
                                  >
                                    Start
                                  </span>
                                  <RaDateInput
                                    initialValue={raStartDisplay}
                                    disabled={startSaving}
                                    onCommit={(v) =>
                                      saveRaDate(
                                        "reverseAuctionStartDate",
                                        v,
                                        raStartDisplay,
                                      )
                                    }
                                  />
                                  {startSaving && (
                                    <Loader2 size={12} className="spin" />
                                  )}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#5f6368",
                                      width: 30,
                                      textAlign: "right",
                                    }}
                                  >
                                    End
                                  </span>
                                  <RaDateInput
                                    initialValue={raEndDisplay}
                                    disabled={endSaving}
                                    onCommit={(v) =>
                                      saveRaDate(
                                        "reverseAuctionEndDate",
                                        v,
                                        raEndDisplay,
                                      )
                                    }
                                  />
                                  {endSaving && (
                                    <Loader2 size={12} className="spin" />
                                  )}
                                </div>
                              </div>
                            );
                            cellClass = "col-center";
                          }
                        } else {
                          cellVal =
                            record[col.accessor as keyof EpcTenderRecord];

                          if (col.accessor === "attachmentUrl") {
                            const filesRaw = record.tenderFiles as string | undefined;
                            let url = "";
                            if (filesRaw) {
                              try {
                                const files: Array<{ url: string; source: string; tags: string[] }> = JSON.parse(filesRaw);
                                const costingFile = files.find((f) => f.tags?.includes("costingAttachment"));
                                url = costingFile?.source && costingFile.source !== 'SHEET_SYNC'
                                  ? `/api/executive-files/view/${costingFile.source}`
                                  : costingFile?.url ?? "";
                              } catch {}
                            }
                            cellContent = url ? (
                              <a
                                href={url.startsWith('/api/')
                                  ? `${url}?auth=${encodeURIComponent("Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE")}`
                                  : url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="table-attachment-link"
                                title="Click to view costing attachment"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <FileText size={14} /> Costing
                              </a>
                            ) : (
                              "-"
                            );
                            cellClass = "col-center";
                          } else if (col.accessor === "tenderDocument") {
                            const filesRaw = record.tenderFiles as string | undefined;
                            let docUrl = "";
                            let docName = "";
                            if (filesRaw) {
                              try {
                                const files: Array<{ url: string; name?: string; tags: string[] }> = JSON.parse(filesRaw);
                                const doc = files.find((f) => f.tags?.includes("tenderDocument"));
                                docUrl = doc?.url ?? "";
                                docName = doc?.name ?? "Tender Document";
                              } catch {}
                            }
                            cellContent = docUrl ? (
                              <a
                                href={docUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="table-attachment-link"
                                title={docName}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <FileText size={14} /> Show Tender Document
                              </a>
                            ) : (
                              "-"
                            );
                            cellClass = "col-center";
                          } else if (col.accessor === "reportings") {
                            const rawJson = cellVal as string | undefined;
                            let entries: { officer: string; address?: string; quantity?: string }[] = [];
                            if (rawJson) {
                              try {
                                const parsed = JSON.parse(rawJson);
                                if (Array.isArray(parsed)) entries = parsed;
                              } catch {}
                            }
                            cellContent = (
                              <div className="relative group/cell h-full">
                                <div style={{ maxHeight: 80, overflowY: "auto", whiteSpace: "normal" }} className="flex flex-col gap-1 text-xs">
                                  {entries.length > 0 ? entries.map((e, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="font-medium">{e.officer}</span>
                                      {e.quantity && <span className="text-slate-500">qty: {e.quantity}</span>}
                                    </div>
                                  )) : <span className="text-slate-300">-</span>}
                                </div>
                                <button
                                  className="opacity-0 group-hover/cell:opacity-100 transition-all absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center bg-brand hover:bg-brand-accent p-1 shadow-sm cursor-pointer"
                                  title="Edit Reporting Officers"
                                  onClick={(e) => { e.stopPropagation(); setReportingDialogRecord(record); }}
                                >
                                  <Pencil className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            );
                            cellClass = "col-left";
                          } else if (col.accessor === "emdPaymentMode") {
                            const isSaving = !!savingKeys[`${record.id}-emdPaymentMode`];
                            const val = (cellVal as string) || "";
                            cellContent = (
                              <Select
                                value={val}
                                disabled={isSaving}
                                onValueChange={(v) => handleMergedFieldSave(record, "emdPaymentMode", v ?? "", () => {}, () => {})}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="table-editable-select status-select w-full text-[11px]"
                                  style={{ minWidth: "100px" }}
                                >
                                  <SelectValue placeholder="(Blank)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">(Blank)</SelectItem>
                                  <SelectItem value="Draft">Draft</SelectItem>
                                  <SelectItem value="Bank Guarantee">Bank Guarantee</SelectItem>
                                  <SelectItem value="Online">Online</SelectItem>
                                  <SelectItem value="NO">NO</SelectItem>
                                </SelectContent>
                              </Select>
                            );
                            cellClass = "col-center col-editable";
                          } else if (col.accessor === "price") {
                            const isSaving = !!savingKeys[`${record.id}-price`];
                            const val = (cellVal as string) || "";
                            cellContent = val ? (
                              <span
                                className={`price-basis-badge ${val.toLowerCase().includes("variable") ? "variable" : "firm"}`}
                              >
                                {val}
                              </span>
                            ) : (
                              <Select
                                value=""
                                disabled={isSaving}
                                onValueChange={(v) => {
                                  handleMergedFieldSave(record, "price", v ?? "", () => {}, () => {});
                                }}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="table-editable-select status-select w-full text-[11px]"
                                  style={{ minWidth: "100px" }}
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
                            cellClass = "col-center col-editable";
                          } else if (col.type === "currency") {
                            cellContent = formatCurrency(
                              cellVal as number | null,
                            );
                            cellClass = "col-currency";
                          } else if (col.type === "percentage") {
                            cellContent = formatPercentage(
                              cellVal as number | null,
                            );
                            cellClass = "col-percentage";
                            if (cellVal !== null) {
                              cellClass +=
                                (cellVal as number) < 0 ? " col-lost" : ""; // Optional text highlight
                            }
                          } else if (col.type === "date") {
                            const dateVal = cellVal as Date | null;
                            cellContent = formatDate(dateVal);
                            if (
                              col.accessor === "lastDateOfSubmission" &&
                              showDeadlineOverBadge &&
                              dateVal &&
                              !isNaN(dateVal.getTime())
                            ) {
                              if (isBeforeTodayIST(dateVal)) {
                                cellContent = (
                                  <div
                                    className="flex flex-col items-center gap-1"
                                    style={{ whiteSpace: "nowrap" }}
                                  >
                                    <span>{formatDate(dateVal)}</span>
                                    <span
                                      className="status-badge lost"
                                      style={{
                                        fontSize: "10px",
                                        padding: "2px 6px",
                                      }}
                                    >
                                      Deadline Over
                                    </span>
                                  </div>
                                );
                              }
                            }
                          } else if (col.type === "boolean") {
                            if (col.accessor === "reverseAuctionApplicable") {
                              // const hasRaRule =
                              //   record.raQualificationRule != null &&
                              //   record.raQualificationRule !== "";

                              // if (hasRaRule) {
                              //   cellContent = <span>Yes</span>;
                              //   cellClass = "col-center";
                              // } else {
                              {
                                const raVal =
                                  overrides[record.id!]
                                    ?.reverseAuctionApplicable !== undefined
                                    ? overrides[record.id!]
                                        ?.reverseAuctionApplicable
                                    : record.reverseAuctionApplicable;
                                const isSaving =
                                  !!savingKeys[
                                    `${record.id}::reverseAuctionApplicable`
                                  ];

                                if (readOnly && !editableColumns.includes("reverseAuctionApplicable")) {
                                  const raDisplay = raVal === true ? "Yes" : raVal === false ? "No" : "-";
                                  const raFile = getRaCostingFile(record.tenderFiles);
                                  const raHref = buildRaCostingHref(raFile);
                                  cellContent = (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                                      <span>{raDisplay}</span>
                                      {raFile && raHref && (
                                        <a
                                          href={raHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="table-attachment-link"
                                          onClick={(e) => e.stopPropagation()}
                                          title={raFile.name ? `${raFile.name}${raFile.extension ?? ""}` : "RA Costing Sheet"}
                                          style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px" }}
                                        >
                                          <FileSpreadsheet size={12} /> RA Sheet
                                        </a>
                                      )}
                                    </div>
                                  );
                                  cellClass = "col-center";
                                } else {
                                  const raIsYes = raVal === true;
                                  const raIsNo = raVal === false;
                                  const raFile = getRaCostingFile(record.tenderFiles);
                                  const raHref = buildRaCostingHref(raFile);
                                  cellContent = (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "4px 0" }}>
                                      <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() =>
                                          handleUpdate(
                                            record,
                                            "reverseAuctionApplicable",
                                            raIsYes ? null : true,
                                          )
                                        }
                                        style={{
                                          width: "28px", height: "28px", borderRadius: "4px",
                                          fontSize: "11px", fontWeight: 700, border: "2px solid",
                                          cursor: isSaving ? "not-allowed" : "pointer",
                                          opacity: isSaving ? 0.5 : 1,
                                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                                          backgroundColor: isSaving ? "#e2e8f0" : raIsYes ? "#22c55e" : "#ffffff",
                                          color: isSaving ? "#94a3b8" : raIsYes ? "#ffffff" : "#94a3b8",
                                          borderColor: isSaving ? "#cbd5e1" : raIsYes ? "#16a34a" : "#cbd5e1",
                                        }}
                                      >
                                        {isSaving ? "..." : "Y"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() =>
                                          handleUpdate(
                                            record,
                                            "reverseAuctionApplicable",
                                            raIsNo ? null : false,
                                          )
                                        }
                                        style={{
                                          width: "28px", height: "28px", borderRadius: "4px",
                                          fontSize: "11px", fontWeight: 700, border: "2px solid",
                                          cursor: isSaving ? "not-allowed" : "pointer",
                                          opacity: isSaving ? 0.5 : 1,
                                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                                          backgroundColor: isSaving ? "#e2e8f0" : raIsNo ? "#ef4444" : "#ffffff",
                                          color: isSaving ? "#94a3b8" : raIsNo ? "#ffffff" : "#94a3b8",
                                          borderColor: isSaving ? "#cbd5e1" : raIsNo ? "#dc2626" : "#cbd5e1",
                                        }}
                                      >
                                        {isSaving ? "..." : "N"}
                                      </button>
                                      </div>
                                      {raFile && raHref && (
                                        <a
                                          href={raHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="table-attachment-link"
                                          onClick={(e) => e.stopPropagation()}
                                          title={raFile.name ? `${raFile.name}${raFile.extension ?? ""}` : "RA Costing Sheet"}
                                          style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px" }}
                                        >
                                          <FileSpreadsheet size={12} /> RA Sheet
                                        </a>
                                      )}
                                    </div>
                                  );
                                  cellClass = "col-center";
                                }
                              }
                            } else if (col.accessor === "participated") {
                              const participatedVal = cellVal as boolean | null;
                              const isYes = participatedVal === true;
                              const isNo = participatedVal === false;

                              if (readOnly && !editableColumns.includes("participated")) {
                                cellContent = isYes ? (
                                  <span className="status-badge won" style={{ fontSize: "11px", padding: "2px 8px" }}>Yes</span>
                                ) : isNo ? (
                                  <span className="status-badge lost" style={{ fontSize: "11px", padding: "2px 8px" }}>No</span>
                                ) : (
                                  <span>-</span>
                                );
                                cellClass = "col-center";
                              } else {
                                const reduxRow = tenderData?.rows.find(r => String(r.id) === String(record.id));
                                const reduxIndex = reduxRow != null ? tenderData!.rows.indexOf(reduxRow) : -1;
                                const updKey = `${reduxIndex}-participated`;
                                const isUpdating = !!updatingCells[updKey];

                                cellContent = (
                                  <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
                                    <button
                                      type="button"
                                      disabled={isUpdating}
                                      onClick={() => {
                                        if (!record.id) return;
                                        if (reduxIndex < 0) {
                                          toast.error("Record not found in store. Please refresh and try again.");
                                          return;
                                        }
                                        const oldVal = String(tenderData!.rows[reduxIndex]?.participated ?? "");
                                        dispatch(updateTenderCell({
                                          rowIndex: reduxIndex,
                                          field: "participated",
                                          value: isYes ? "null" : "true",
                                          tenderMergedId: Number(record.id),
                                          oldValue: oldVal,
                                        }))
                                          .unwrap()
                                          .then(() => {
                                            toast.success("Participation updated!");
                                          })
                                          .catch((err: any) => {
                                            toast.error(err?.message || "Failed to update participation.");
                                          });
                                      }}
                                      style={{
                                        width: "28px", height: "28px", borderRadius: "4px",
                                        fontSize: "11px", fontWeight: 700, border: "2px solid",
                                        cursor: isUpdating ? "not-allowed" : "pointer",
                                        opacity: isUpdating ? 0.5 : 1,
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        backgroundColor: isUpdating ? "#e2e8f0" : isYes ? "#22c55e" : "#ffffff",
                                        color: isUpdating ? "#94a3b8" : isYes ? "#ffffff" : "#94a3b8",
                                        borderColor: isUpdating ? "#cbd5e1" : isYes ? "#16a34a" : "#cbd5e1",
                                      }}
                                    >
                                      {isUpdating ? "..." : "Y"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isUpdating}
                                      onClick={() => {
                                        if (!record.id) return;
                                        if (reduxIndex < 0) {
                                          toast.error("Record not found in store. Please refresh and try again.");
                                          return;
                                        }
                                        const oldVal = String(tenderData!.rows[reduxIndex]?.participated ?? "");
                                        dispatch(updateTenderCell({
                                          rowIndex: reduxIndex,
                                          field: "participated",
                                          value: isNo ? "null" : "false",
                                          tenderMergedId: Number(record.id),
                                          oldValue: oldVal,
                                        }))
                                          .unwrap()
                                          .then(() => {
                                            toast.success("Participation updated!");
                                          })
                                          .catch((err: any) => {
                                            toast.error(err?.message || "Failed to update participation.");
                                          });
                                      }}
                                      style={{
                                        width: "28px", height: "28px", borderRadius: "4px",
                                        fontSize: "11px", fontWeight: 700, border: "2px solid",
                                        cursor: isUpdating ? "not-allowed" : "pointer",
                                        opacity: isUpdating ? 0.5 : 1,
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        backgroundColor: isUpdating ? "#e2e8f0" : isNo ? "#ef4444" : "#ffffff",
                                        color: isUpdating ? "#94a3b8" : isNo ? "#ffffff" : "#94a3b8",
                                        borderColor: isUpdating ? "#cbd5e1" : isNo ? "#dc2626" : "#cbd5e1",
                                      }}
                                    >
                                      {isUpdating ? "..." : "N"}
                                    </button>
                                  </div>
                                );
                                cellClass = "col-center";
                              }
                            } else {
                              const isApp = cellVal as boolean | null;
                              cellContent =
                                isApp === null || isApp === undefined ? (
                                  <span className="ra-icon not-applicable">
                                    -
                                  </span>
                                ) : (
                                  <span
                                    className={`ra-icon ${isApp ? "applicable" : "not-applicable"}`}
                                  >
                                    {isApp ? (
                                      <Check size={14} />
                                    ) : (
                                      <Circle size={14} />
                                    )}
                                  </span>
                                );
                              cellClass = "col-center";
                            }
                          } else if (col.type === "status") {
                            const statusVal = (cellVal as string) || "";
                            if (readOnly && !editableColumns.includes("currentStatus")) {
                              cellContent = statusVal ? (
                                <span className={`status-badge ${getStatusClass(statusVal)}`}>{statusVal}</span>
                              ) : (
                                <span>-</span>
                              );
                              cellClass = "col-center";
                            } else {
                              const isSaving = !!savingKeys[`${record.id}::currentStatus`];
                              cellContent = (
                                <Select
                                  value={statusVal}
                                  disabled={isSaving}
                                  onValueChange={(v) => {
                                    const key = `${record.id}::currentStatus`;
                                    setSavingKeys(prev => ({ ...prev, [key]: true }));
                                    dispatch(updateTenderMergedField({
                                      rowIndex: 0,
                                      field: "currentStatus",
                                      value: v ?? "",
                                      tenderMergedId: Number(record.id),
                                      oldValue: statusVal,
                                    }))
                                      .unwrap()
                                      .then(() => toast.success("Status updated!"))
                                      .catch((err) => toast.error(err?.message || "Failed to update status."))
                                      .finally(() => setSavingKeys(prev => { const c = { ...prev }; delete c[key]; return c; }));
                                  }}
                                >
                                  <SelectTrigger size="sm" className="table-editable-select status-select w-full">
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="">None</SelectItem>
                                    {CURRENT_STATUS_OPTIONS.map(opt => (
                                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              );
                              cellClass = "col-center col-editable";
                            }
                          } else if (col.type === "decision") {
                            const decVal = cellVal as ManagementDecision;
                            cellContent = (
                              <span
                                className={`decision-badge ${getDecisionClass(decVal)}`}
                              >
                                {decVal}
                              </span>
                            );
                            cellClass = "col-center";
                          } else {
                            if (col.accessor === "bgStatus") {
                              const val = (cellVal as string) || "";
                              const isSaving = !!savingKeys[`${record.id}-bgStatus`];
                              cellContent = (
                                <Select
                                  value={val}
                                  disabled={isSaving}
                                  onValueChange={(v) => handleMergedFieldSave(record, "bgStatus", v ?? "", () => {}, () => {})}
                                >
                                  <SelectTrigger
                                    size="sm"
                                    className="table-editable-select status-select w-full text-[11px]"
                                    style={{ minWidth: "100px" }}
                                  >
                                    <SelectValue placeholder="(Blank)" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="">(Blank)</SelectItem>
                                    <SelectItem value="PENDING">PENDING</SelectItem>
                                    <SelectItem value="TO BE FOLLOWED UP">TO BE FOLLOWED UP</SelectItem>
                                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                                  </SelectContent>
                                </Select>
                              );
                              cellClass = "col-center col-editable";
                            } else if (col.accessor === "cva") {
                              let parts: string[] = [];
                              if (cellVal != null && cellVal !== "") {
                                if (typeof cellVal === "object" && !(cellVal instanceof Date)) {
                                  if (Array.isArray(cellVal)) {
                                    parts = (cellVal as any[]).map(String);
                                  } else {
                                    parts = Object.values(cellVal as Record<string, unknown>).map(String);
                                  }
                                } else if (typeof cellVal === "string") {
                                  try {
                                    const parsed = JSON.parse(cellVal);
                                    if (Array.isArray(parsed)) {
                                      parts = parsed.map(String);
                                    } else if (typeof parsed === "object" && parsed !== null) {
                                      parts = Object.values(parsed).map(String);
                                    }
                                  } catch {
                                    parts = cellVal.split("@").filter(Boolean);
                                  }
                                }
                              }
                              cellContent = parts.length > 0 ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                                  {parts.map((part, i) => <div key={i} style={{ background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>{part}</div>)}
                                </div>
                              ) : "-";
                              cellClass = "col-center";
                            } else if (col.accessor === "catalogueDone") {
                              const catVal = String(cellVal ?? "");
                              const isYes = catVal === "YES";
                              const isNo = catVal === "NO";
                              const reduxRow = tenderData?.rows.find(r => String(r.id) === String(record.id));
                              const reduxIndex = reduxRow != null ? tenderData!.rows.indexOf(reduxRow) : -1;
                              const updKey = `${reduxIndex}-catalogueDone`;
                              const isUpdating = !!updatingCells[updKey];
                              const dispatchCatalogue = (value: "YES" | "NO" | "NOT_DECIDED") => {
                                if (!record.id) return;
                                if (reduxIndex < 0) {
                                  toast.error("Record not found in store. Please refresh and try again.");
                                  return;
                                }
                                const oldVal = String(tenderData!.rows[reduxIndex]?.catalogueDone ?? "");
                                dispatch(updateTenderCell({
                                  rowIndex: reduxIndex,
                                  field: "catalogueDone",
                                  value,
                                  tenderMergedId: Number(record.id),
                                  oldValue: oldVal,
                                }))
                                  .unwrap()
                                  .then(() => {
                                    toast.success("Catalogue Done updated!");
                                  })
                                  .catch((err: any) => {
                                    toast.error(err?.message || "Failed to update Catalogue Done.");
                                  });
                              };
                              cellContent = (
                                <div style={{ display: "flex", gap: "4px", padding: "4px 0", justifyContent: "center" }}>
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatchCatalogue(isYes ? "NOT_DECIDED" : "YES");
                                    }}
                                    style={{
                                      width: "28px", height: "28px", borderRadius: "4px",
                                      fontSize: "11px", fontWeight: 700, border: "2px solid",
                                      cursor: isUpdating ? "not-allowed" : "pointer",
                                      opacity: isUpdating ? 0.5 : 1,
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      backgroundColor: isUpdating ? "#e2e8f0" : isYes ? "#22c55e" : "#ffffff",
                                      color: isUpdating ? "#94a3b8" : isYes ? "#ffffff" : "#94a3b8",
                                      borderColor: isUpdating ? "#cbd5e1" : isYes ? "#16a34a" : "#cbd5e1",
                                    }}
                                  >
                                    {isUpdating ? "..." : "Y"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatchCatalogue(isNo ? "NOT_DECIDED" : "NO");
                                    }}
                                    style={{
                                      width: "28px", height: "28px", borderRadius: "4px",
                                      fontSize: "11px", fontWeight: 700, border: "2px solid",
                                      cursor: isUpdating ? "not-allowed" : "pointer",
                                      opacity: isUpdating ? 0.5 : 1,
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      backgroundColor: isUpdating ? "#e2e8f0" : isNo ? "#ef4444" : "#ffffff",
                                      color: isUpdating ? "#94a3b8" : isNo ? "#ffffff" : "#94a3b8",
                                      borderColor: isUpdating ? "#cbd5e1" : isNo ? "#dc2626" : "#cbd5e1",
                                    }}
                                  >
                                    {isUpdating ? "..." : "N"}
                                  </button>
                                </div>
                              );
                              cellClass = "col-center";
                            } else {
                              const moneySet = new Set(["ourValue", "valueOfRank1", "valueOfRank2"]);
                              if (variant === "party" && moneySet.has(col.accessor as string)) {
                                cellContent = formatMoney(cellVal);
                              } else {
                                cellContent =
                                  cellVal !== null && cellVal !== undefined
                                    ? String(cellVal)
                                    : "-";
                              }
                            }
                          }
                        }

                        return (
                          <td
                            key={col.accessor}
                            {...(col.accessor === "docketNo" && rowIdx === 0 ? { rowSpan: group.records.length } : {})}
                            className={col.sticky ? `${cellClass} sticky-col` : cellClass}
                            style={{
                              width: `${columnWidths[col.accessor]}px`,
                              ...(col.sticky ? { left: stickyLeftOffsets[col.accessor] } : {}),
                            }}
                            onClick={
                              editableCfg &&
                              editingCell?.id !== record.id &&
                              editableCfg.canEdit(
                                record,
                                readOnly,
                                editableColumns,
                              ) &&
                              !savingKeys[`${record.id}-${col.accessor}`]
                                ? () =>
                                    setEditingCell({
                                      id: record.id!,
                                      accessor: col.accessor,
                                    })
                                : undefined
                            }
                            title={
                              col.accessor !== "rawMaterials" &&
                              col.type !== "boolean" &&
                              cellVal !== null &&
                              cellVal !== undefined
                                ? String(cellVal)
                                : undefined
                            }
                          >
                            <div className="cell-scroll-wrap">
                              {cellContent}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  )))
                )}
            </tbody>
        </table>
      </div>

      {/* 11. Pagination Footer */}
      <div className="tender-table-footer">
        <div className="footer-left">
          <span>Rows per page:</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => {
              setRowsPerPage(Number(v));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger size="sm" className="rows-per-page-select h-7 w-auto text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="footer-center">
          Showing {totalRecords > 0 ? (activePage - 1) * rowsPerPage + 1 : 0} -{" "}
          {Math.min(activePage * rowsPerPage, totalRecords)} of {totalRecords}
        </div>

        <div className="footer-right">
          <button
            className="page-btn"
            onClick={() => setCurrentPage(1)}
            disabled={activePage === 1}
          >
            FIRST
          </button>
          <button
            className="page-btn"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={activePage === 1}
          >
            PREV
          </button>

          {/* Render abbreviated page numbers */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
            // Logic to center the current page index in the page range
            let pageNum = idx + 1;
            if (totalPages > 5 && activePage > 3) {
              pageNum = activePage - 3 + idx;
              if (pageNum + (4 - idx) > totalPages) {
                pageNum = totalPages - 4 + idx;
              }
            }
            return (
              <button
                key={pageNum}
                className={`page-btn ${activePage === pageNum ? "active" : ""}`}
                onClick={() => setCurrentPage(pageNum)}
              >
                {pageNum}
              </button>
            );
          })}

          {totalPages > 5 && activePage < totalPages - 2 && (
            <>
              <span style={{ padding: "0 4px", color: "rgba(0,0,0,0.4)" }}>
                ...
              </span>
              <button
                className={`page-btn ${activePage === totalPages ? "active" : ""}`}
                onClick={() => setCurrentPage(totalPages)}
              >
                {totalPages}
              </button>
            </>
          )}

          <button
            className="page-btn"
            onClick={() =>
              setCurrentPage((prev) => Math.min(totalPages, prev + 1))
            }
            disabled={activePage === totalPages}
          >
            NEXT
          </button>
          <button
            className="page-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={activePage === totalPages}
          >
            LAST
          </button>
        </div>
      </div>

      <AttachmentModal
        isOpen={isAttachmentModalOpen}
        onClose={() => setIsAttachmentModalOpen(false)}
        files={selectedFiles}
      />

      {catalogueUploadRow && (
        <TenderDocumentUploadDialog
          row={catalogueUploadRow as unknown as Record<string, unknown>}
          isSaving={catalogueUploading}
          defaultFileType="catalogueDocument"
          onSave={handleCatalogueUpload}
          onClose={() => setCatalogueUploadRow(null)}
        />
      )}

      {officeDialogRecord && (
        <MergedOfficeEditDialog
          row={officeDialogRecord as unknown as Record<string, unknown>}
          isSaving={officeDialogSaving}
          onSave={handleOfficeDialogSave}
          onClose={() => setOfficeDialogRecord(null)}
        />
      )}

      {websiteDialogRecord && (
        <WebsiteEditDialog
          row={websiteDialogRecord as unknown as Record<string, unknown>}
          isSaving={false}
          onSave={handleWebsiteSave}
          onClose={() => setWebsiteDialogRecord(null)}
        />
      )}

      {reportingDialogRecord && (
        <ReportingOfficersEditDialog
          row={reportingDialogRecord as unknown as Record<string, unknown>}
          isSaving={false}
          onSave={handleReportingSave}
          onClose={() => setReportingDialogRecord(null)}
        />
      )}

      <TenderDetailSheet
        open={!!detailRecords}
        onOpenChange={(open) => { if (!open) setDetailRecords(null); }}
        records={detailRecords ?? []}
        visibleAccessors={visibleColumns.map((c) => c.accessor)}
        readOnly={readOnly}
        editableColumns={editableColumns}
      />

    </div>
  );
};
