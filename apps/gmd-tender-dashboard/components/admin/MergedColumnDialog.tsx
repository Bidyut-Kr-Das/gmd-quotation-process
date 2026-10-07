"use client";

import { useState, useEffect } from "react";
import { Search, X, Loader2, Check } from "lucide-react";

interface MergedColumnDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    label: string;
    separator: string;
    fields: string[];
  }) => Promise<void>;
  dbFieldOptions: string[];
  initialData?: {
    label: string;
    separator: string;
    fields: string[];
  } | null;
}

export default function MergedColumnDialog({
  open,
  onClose,
  onSave,
  dbFieldOptions,
  initialData,
}: MergedColumnDialogProps) {
  const [label, setLabel] = useState("");
  const [separator, setSeparator] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [fieldSearch, setFieldSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setLabel(initialData.label);
        setSeparator(initialData.separator);
        setSelectedFields(new Set(initialData.fields));
      } else {
        setLabel("");
        setSeparator("");
        setSelectedFields(new Set());
      }
      setFieldSearch("");
      setError("");
      setSaving(false);
    }
  }, [open, initialData]);

  function toggleField(field: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  }

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError("Label is required");
      return;
    }
    if (selectedFields.size < 2) {
      setError("Select at least 2 fields to merge");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        label: trimmedLabel,
        separator,
        fields: Array.from(selectedFields),
      });
      onClose();
    } catch {
      setError("Failed to save merged column");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {isEditing ? "Edit Merged Column" : "Add Merged Column"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <label className="text-slate-500 text-[11px] block mb-1">
              COLUMN LABEL
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Organization@Department Name"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          <div>
            <label className="text-slate-500 text-[11px] block mb-1">
              SEPARATOR
            </label>
            <input
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder=" @ "
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          <div>
            <label className="text-slate-500 text-[11px] block mb-1">
              FIELDS TO MERGE <span className="text-slate-300 font-normal">(select at least 2)</span>
            </label>
            <div
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#999",
                  }}
                />
                <input
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder="Search fields..."
                  className="w-full border-0 border-b border-slate-200 pl-8 pr-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none"
                />
              </div>
              <div
                style={{
                  maxHeight: "160px",
                  overflowY: "auto",
                  padding: "4px",
                }}
              >
              {(fieldSearch.trim()
                ? dbFieldOptions.filter((f) =>
                    f.toLowerCase().includes(fieldSearch.toLowerCase()),
                  )
                : dbFieldOptions
              ).length === 0 ? (
                <p style={{ padding: "12px 8px", textAlign: "center", color: "#999", fontSize: "12px" }}>
                  No fields match your search.
                </p>
              ) : (
                (fieldSearch.trim()
                  ? dbFieldOptions.filter((f) =>
                      f.toLowerCase().includes(fieldSearch.toLowerCase()),
                    )
                  : dbFieldOptions
                ).map((field) => (
                <label
                  key={field}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    background: selectedFields.has(field)
                      ? "#f0f4f8"
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.has(field)}
                    onChange={() => toggleField(field)}
                    className="accent-brand"
                  />
                  {field}
                </label>
              ))
            )}
              </div>
            </div>
          </div>

          {error && <p className="text-red-500 text-[12px]">{error}</p>}
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
