"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface MergedOfficeEditDialogProps {
  row: Record<string, unknown>;
  isSaving: boolean;
  onSave: (params: {
    tenderMergedId: number;
    officeName: string;
    consigneesReportingOfficer: string;
    oldOfficeName: string;
    oldConsignees: string;
  }) => void;
  onClose: () => void;
}

export default function MergedOfficeEditDialog({
  row,
  isSaving,
  onSave,
  onClose,
}: MergedOfficeEditDialogProps) {
  const currentOfficeName = String(row.officeName ?? "");
  const currentConsignees = String(row.consigneesReportingOfficer ?? "");
  const [officeName, setOfficeName] = useState(currentOfficeName);
  const [consignees, setConsignees] = useState(currentConsignees);
  const organization = String(row.organization ?? "");
  const tenderBrief = String(row.tenderBrief ?? "");

  const briefPreview =
    tenderBrief.length > 100
      ? tenderBrief.slice(0, 100) + "..."
      : tenderBrief;

  const handleSave = () => {
    if (!officeName.trim() && !consignees.trim()) return;
    onSave({
      tenderMergedId: Number(row.id),
      officeName: officeName.trim(),
      consigneesReportingOfficer: consignees.trim(),
      oldOfficeName: currentOfficeName,
      oldConsignees: currentConsignees,
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
            Edit Office Name @ Consignees
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
            <span className="text-slate-500 text-[11px]">OFFICE NAME</span>
            <input
              type="text"
              value={officeName}
              onChange={(e) => setOfficeName(e.target.value)}
              placeholder="Office name"
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>

          <div>
            <span className="text-slate-500 text-[11px]">CONSIGNEES / REPORTING OFFICER</span>
            <input
              type="text"
              value={consignees}
              onChange={(e) => setConsignees(e.target.value)}
              placeholder="Consignees or reporting officer"
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
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
            disabled={isSaving || (!officeName.trim() && !consignees.trim())}
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
