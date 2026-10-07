"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, FileArchive } from "lucide-react";
import { FileIcon } from "@/lib/file-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const TENDER_FILE_TYPE_OPTIONS = [
  { value: "tenderDocument", label: "Tender Document" },
  { value: "costingAttachment", label: "Costing Attachment" },
  { value: "catalogueDocument", label: "Catalogue Document" },
] as const;

interface TenderDocumentUploadDialogProps {
  row: Record<string, unknown>;
  isSaving: boolean;
  defaultFileType?: string;
  onSave: (params: {
    tenderMergedId: number;
    file: File;
    fileType: string;
  }) => void;
  onClose: () => void;
}

export default function TenderDocumentUploadDialog({
  row,
  isSaving,
  defaultFileType,
  onSave,
  onClose,
}: TenderDocumentUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<string>(
    defaultFileType ?? TENDER_FILE_TYPE_OPTIONS[0].value,
  );

  const organization = String(row.organization ?? row.nameOfTheClient ?? "");
  const tenderBrief = String(row.tenderBrief ?? "");

  const briefPreview =
    tenderBrief.length > 100
      ? tenderBrief.slice(0, 100) + "..."
      : tenderBrief;

  const handleChoose = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    if (selected) e.target.value = "";
  };

  const handleSave = () => {
    if (!file) return;
    onSave({
      tenderMergedId: Number(row.id),
      file,
      fileType,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Upload Tender File
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-slate-500 text-[11px]">TENDER BRIEF</span>
            <p className="text-slate-700 mt-0.5 text-[12px] leading-snug">
              {briefPreview}
            </p>
          </div>

          <div>
            <span className="text-slate-500 text-[11px]">ORGANIZATION</span>
            <p className="text-slate-700 mt-0.5 text-[13px] font-medium">
              {organization || "-"}
            </p>
          </div>

          <div>
            <span className="text-slate-500 text-[11px]">FILE TYPE</span>
            <Select
              value={fileType}
              onValueChange={(v) => {
                if (v) setFileType(v);
              }}
            >
              <SelectTrigger className="w-full mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TENDER_FILE_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="text-slate-500 text-[11px]">FILE</span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc,.zip,.png,.jpg,.jpeg,.gif,.webp,.bmp,.xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <span className="inline-flex items-center gap-2 text-[13px] text-slate-700 truncate">
                  {file.name.toLowerCase().endsWith(".zip") ? (
                    <FileArchive className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <FileIcon
                      extension={file.name.includes(".")
                        ? "." + file.name.split(".").pop()!.toLowerCase()
                        : ""}
                      size={16}
                    />
                  )}
                  {file.name}
                </span>
                <button
                  onClick={() => setFile(null)}
                  className="text-xs text-slate-400 hover:text-red-500 ml-2 shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={handleChoose}
                className="mt-1 w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-md px-3 py-4 text-[13px] text-slate-400 hover:border-brand-light hover:bg-brand-light hover:text-brand transition-colors"
              >
                <Upload className="w-4 h-4" />
                Choose file
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !file}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
