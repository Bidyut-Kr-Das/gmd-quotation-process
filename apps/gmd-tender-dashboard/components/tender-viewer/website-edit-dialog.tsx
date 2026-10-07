"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface WebsiteEditDialogProps {
  row: Record<string, unknown>;
  isSaving: boolean;
  onSave: (params: {
    tenderMergedId: number;
    website: string;
    oldValue: string;
  }) => void;
  onClose: () => void;
}

export default function WebsiteEditDialog({
  row,
  isSaving,
  onSave,
  onClose,
}: WebsiteEditDialogProps) {
  const currentWebsite = String(row.website ?? "");
  const [website, setWebsite] = useState(currentWebsite);
  const organization = String(row.organization ?? row.nameOfTheClient ?? "");
  const tenderBrief = String(row.tenderBrief ?? "");

  const briefPreview =
    tenderBrief.length > 100
      ? tenderBrief.slice(0, 100) + "..."
      : tenderBrief;

  const handleSave = () => {
    if (!website.trim()) return;
    onSave({
      tenderMergedId: Number(row.id),
      website: website.trim(),
      oldValue: currentWebsite,
    });
  };

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
            Edit Website URL
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
            <span className="text-slate-500 text-[11px]">WEBSITE URL</span>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
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
            disabled={isSaving || !website.trim()}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Website
          </button>
        </div>
      </div>
    </div>
  );
}
