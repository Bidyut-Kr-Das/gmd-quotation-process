"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface ReportingOfficerEntry {
  officer: string;
  address: string;
  quantity: string;
}

interface ReportingOfficersEditDialogProps {
  row: Record<string, unknown>;
  isSaving: boolean;
  onSave: (params: {
    tenderMergedId: number;
    reportings: string;
    oldValue: string;
  }) => void;
  onClose: () => void;
}

export default function ReportingOfficersEditDialog({
  row,
  isSaving,
  onSave,
  onClose,
}: ReportingOfficersEditDialogProps) {
  const rawReportings = String(row.reportings ?? "");
  let initialEntries: ReportingOfficerEntry[] = [];
  try {
    const parsed = JSON.parse(rawReportings);
    if (Array.isArray(parsed)) {
      initialEntries = parsed.map((e: any) => ({
        officer: e.officer || "",
        address: e.address || "",
        quantity: e.quantity ?? "",
      }));
    }
  } catch {}
  if (initialEntries.length === 0) {
    initialEntries = [{ officer: "", address: "", quantity: "" }];
  }

  const [entries, setEntries] = useState<ReportingOfficerEntry[]>(initialEntries);
  const organization = String(row.organization ?? row.nameOfTheClient ?? "");
  const tenderBrief = String(row.tenderBrief ?? "");
  const briefPreview =
    tenderBrief.length > 100
      ? tenderBrief.slice(0, 100) + "..."
      : tenderBrief;

  const updateEntry = (index: number, field: keyof ReportingOfficerEntry, value: string) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, { officer: "", address: "", quantity: "" }]);
  };

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const hasOfficer = entries.some((e) => e.officer.trim().length > 0);
  const allFilled = entries.every((e) => e.officer.trim().length > 0);

  const handleSave = () => {
    if (!hasOfficer) return;
    const valid = entries.filter((e) => e.officer.trim().length > 0);
    const json = JSON.stringify(
      valid.map((e) => ({
        officer: e.officer.trim(),
        address: e.address.trim(),
        quantity: e.quantity.trim(),
      })),
    );
    onSave({
      tenderMergedId: Number(row.id),
      reportings: json,
      oldValue: rawReportings,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Edit Reporting Officers
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 text-sm mb-4">
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-2 text-slate-500 font-medium w-1/3">Officer *</th>
                <th className="text-left py-2 px-2 text-slate-500 font-medium w-1/3">Address</th>
                <th className="text-left py-2 px-2 text-slate-500 font-medium w-1/6">Quantity</th>
                <th className="text-center py-2 px-2 text-slate-500 font-medium w-10"> </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="py-1.5 px-2">
                    <input
                      type="text"
                      value={entry.officer}
                      onChange={(e) => updateEntry(idx, "officer", e.target.value)}
                      placeholder="Officer name *"
                      className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-accent"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="text"
                      value={entry.address}
                      onChange={(e) => updateEntry(idx, "address", e.target.value)}
                      placeholder="Address"
                      className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-accent"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="text"
                      value={entry.quantity}
                      onChange={(e) => updateEntry(idx, "quantity", e.target.value)}
                      placeholder="Qty"
                      className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-accent"
                    />
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <button
                      onClick={() => removeEntry(idx)}
                      disabled={entries.length === 1}
                      className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          onClick={addEntry}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-brand hover:text-brand"
        >
          <Plus size={14} /> Add Row
        </button>

        {!allFilled && entries.length > 0 && (
          <p className="text-[11px] text-amber-600 mt-1">
            Rows with missing officer name will be removed on save.
          </p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasOfficer}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
