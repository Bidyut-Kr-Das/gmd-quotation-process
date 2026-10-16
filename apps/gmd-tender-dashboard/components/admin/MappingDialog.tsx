"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MappingDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    excelHeader: string;
    dbField: string;
    displayName: string | null;
  }) => Promise<void>;
  dbFieldOptions: string[];
  initialData?: {
    excelHeader: string;
    dbField: string;
    displayName: string | null;
  } | null;
  preSelectedDbField?: string;
}

export default function MappingDialog({
  open,
  onClose,
  onSave,
  dbFieldOptions,
  initialData,
  preSelectedDbField,
}: MappingDialogProps) {
  const [excelHeader, setExcelHeader] = useState("");
  const [dbField, setDbField] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setExcelHeader(initialData.excelHeader);
        setDbField(initialData.dbField);
        setDisplayName(initialData.displayName ?? "");
      } else {
        setExcelHeader("");
        setDbField(preSelectedDbField ?? "");
        setDisplayName("");
      }
      setError("");
      setSaving(false);
    }
  }, [open, initialData, preSelectedDbField]);

  const handleSave = async () => {
    const trimmedHeader = excelHeader.trim();
    const trimmedField = dbField.trim();
    if (!trimmedHeader) {
      setError("Excel Header is required");
      return;
    }
    if (!trimmedField) {
      setError("DB Field is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        excelHeader: trimmedHeader,
        dbField: trimmedField,
        displayName: displayName.trim() || null,
      });
      onClose();
    } catch {
      setError("Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {isEditing ? "Edit Mapping" : "Add Mapping"}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground/80 hover:text-muted-foreground text-lg leading-none"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <label className="text-muted-foreground text-[11px] block mb-1">
              DB FIELD
            </label>
            <Select
              value={dbField}
              onValueChange={(v) => setDbField(v ?? "")}
              disabled={isEditing || !!preSelectedDbField}
            >
              <SelectTrigger
                className="w-full border border-border rounded-md px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-brand-accent disabled:bg-muted disabled:text-muted-foreground data-placeholder:text-muted-foreground/80"
              >
                <SelectValue placeholder="Select a field..." />
              </SelectTrigger>
              <SelectContent>
                {dbFieldOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-muted-foreground text-[11px] block mb-1">
              EXCEL HEADER
            </label>
            <input
              value={excelHeader}
              onChange={(e) => setExcelHeader(e.target.value)}
              placeholder="e.g. portalId"
              className="w-full border border-border rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          <div>
            <label className="text-muted-foreground text-[11px] block mb-1">
              DISPLAY NAME{" "}
              <span className="text-muted-foreground/60 font-normal">(optional)</span>
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="UI column header override"
              className="w-full border border-border rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          {error && (
            <p className="text-red-500 text-[12px]">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {isEditing ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
