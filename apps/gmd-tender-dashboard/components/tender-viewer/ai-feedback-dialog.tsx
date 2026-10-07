"use client";

import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { saveAiFeedback } from "@/lib/slices/tendersSlice";
import { Loader2, MessageSquare } from "lucide-react";

interface AiFeedbackDialogProps {
  row: Record<string, unknown>;
  isSaving: boolean;
  onSave: (params: {
    tenderMergedId: number;
    tenderType: string;
    briefText: string;
    originalAi: string;
    correctedAi: string;
    feedbackReason: string;
  }) => void;
  onClose: () => void;
}

export default function AiFeedbackDialog({
  row,
  isSaving,
  onSave,
  onClose,
}: AiFeedbackDialogProps) {
  const originalAi = String(row.aiRelevanceValid ?? "");
  const isYes = originalAi === "true";
  const tenderBrief = [
    String(row.tenderBrief ?? "").trim(),
    String(row.itemCategory ?? "").trim(),
  ]
    .filter(Boolean)
    .join("@");
  const tenderId = Number(row.id);
  const tenderType = String(row.type === "Gem" ? "Gem" : "NonGem");

  const [correctedAi, setCorrectedAi] = useState(isYes ? "NO" : "YES");
  const [feedbackReason, setFeedbackReason] = useState("");

  const handleSave = () => {
    if (!feedbackReason.trim()) return;
    onSave({
      tenderMergedId: tenderId,
      tenderType,
      briefText: tenderBrief,
      originalAi: isYes ? "YES" : "NO",
      correctedAi,
      feedbackReason: feedbackReason.trim(),
    });
  };

  const briefPreview =
    tenderBrief.length > 100
      ? tenderBrief.slice(0, 100) + "..."
      : tenderBrief;

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
            Provide AI Feedback
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
            <span className="text-slate-500 text-[11px]">AI SAID</span>
            <span
              className={`ml-2 inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                isYes
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {isYes ? "YES" : "NO"}
            </span>
          </div>

          <div className="text-slate-500">
            <span className=" text-[11px]">CORRECT ANSWER</span>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="correctedAi"
                  value="YES"
                  checked={correctedAi === "YES"}
                  onChange={() => setCorrectedAi("YES")}
                  className="accent-brand"
                />
                <span className="text-[13px]">YES</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="correctedAi"
                  value="NO"
                  checked={correctedAi === "NO"}
                  onChange={() => setCorrectedAi("NO")}
                  className="accent-brand"
                />
                <span className="text-[13px]">NO</span>
              </label>
            </div>
          </div>

          <div>
            <span className="text-slate-500 text-[11px]">
              WHY WAS THE AI WRONG?
            </span>
            <textarea
              value={feedbackReason}
              onChange={(e) => setFeedbackReason(e.target.value)}
              placeholder="Explain why the AI's answer was incorrect..."
              rows={4}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent resize-none"
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
            disabled={isSaving || !feedbackReason.trim()}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Feedback
          </button>
        </div>
      </div>
    </div>
  );
}
