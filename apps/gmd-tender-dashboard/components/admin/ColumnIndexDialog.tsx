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

interface ColumnIndexDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    columnName: string;
    displayOrder: number;
    displayName: string | null;
    visible: boolean;
  }) => Promise<void>;
  fieldOptions: string[];
  initialData?: {
    columnName: string;
    displayOrder: number;
    displayName: string | null;
    visible: boolean;
  } | null;
}

export default function ColumnIndexDialog({
  open,
  onClose,
  onSave,
  fieldOptions,
  initialData,
}: ColumnIndexDialogProps) {
  const [columnName, setColumnName] = useState("");
  const [displayOrder, setDisplayOrder] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setColumnName(initialData.columnName);
        setDisplayOrder(String(initialData.displayOrder));
        setDisplayName(initialData.displayName ?? "");
        setVisible(initialData.visible);
      } else {
        setColumnName("");
        setDisplayOrder("");
        setDisplayName("");
        setVisible(true);
      }
      setError("");
      setSaving(false);
    }
  }, [open, initialData]);

  const handleSave = async () => {
    const trimmedName = columnName.trim();
    const trimmedOrder = displayOrder.trim();
    if (!trimmedName) {
      setError("Column Name is required");
      return;
    }
    if (!trimmedOrder) {
      setError("Display Order is required");
      return;
    }
    const orderNum = parseInt(trimmedOrder, 10);
    if (isNaN(orderNum) || orderNum < 0) {
      setError("Display Order must be a valid positive number");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        columnName: trimmedName,
        displayOrder: orderNum,
        displayName: displayName.trim() || null,
        visible,
      });
      onClose();
    } catch {
      setError("Failed to save column index");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const availableOptions = isEditing
    ? fieldOptions
    : fieldOptions.filter((f) => f !== columnName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {isEditing ? "Edit Column Index" : "Add Column Index"}
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
              COLUMN NAME
            </label>
            <Select
              value={columnName}
              onValueChange={(v) => setColumnName(v ?? "")}
              disabled={isEditing}
            >
              <SelectTrigger
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-accent disabled:bg-slate-50 disabled:text-slate-500 data-placeholder:text-slate-400"
              >
                <SelectValue placeholder="Select a column..." />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-slate-500 text-[11px] block mb-1">
              DISPLAY ORDER (Index)
            </label>
            <input
              type="number"
              min="1"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              placeholder="e.g. 1, 2, 3..."
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              If two columns have the same index, they are sorted by creation date.
            </p>
          </div>

          <div>
            <label className="text-slate-500 text-[11px] block mb-1">
              DISPLAY NAME{" "}
              <span className="text-slate-300 font-normal">(optional)</span>
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="UI column header override"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
                className="accent-brand w-4 h-4"
              />
              <span className="text-[13px] text-slate-700">Visible by default</span>
            </label>
            <p className="text-[11px] text-slate-400 mt-0.5 ml-6">
              When unchecked, the column is hidden in the table until toggled via the column picker.
            </p>
          </div>

          {error && (
            <p className="text-red-500 text-[12px]">{error}</p>
          )}
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
