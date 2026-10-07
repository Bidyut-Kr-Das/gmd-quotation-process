"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Check } from "lucide-react";

const SOURCE_OPTIONS = ["MANUAL","UPLOAD_EXCEL","SCRAPE_247","AI","DOCUMENT_PARSE","RA_AUTOMATION","GOOGLE_SHEET_SYNC","SYSTEM"] as const;

interface SopDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    columnName: string;
    description: string | null;
    allocatedTo: string | null;
    email: string | null;
    dailyLog: string | null;
    date: string | null;
    source: string | null;
    doneFromWhere: string | null;
    isManual: boolean;
    dailyLogEnabled: boolean;
    dateEnabled: boolean;
  }) => Promise<void>;
  initialData?: {
    id: number;
    columnName: string;
    description: string | null;
    allocatedTo: string | null;
    email: string | null;
    dailyLog: string | null;
    date: string | null;
    source: string | null;
    doneFromWhere: string | null;
    isManual: boolean | null;
    dailyLogEnabled: boolean | null;
    dateEnabled: boolean | null;
  } | null;
}

export default function SopResponsibilityDialog({ open, onClose, onSave, initialData }: SopDialogProps) {
  const [columnName, setColumnName] = useState("");
  const [description, setDescription] = useState("");
  const [allocatedTo, setAllocatedTo] = useState("");
  const [email, setEmail] = useState("");
  const [dailyLog, setDailyLog] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<string>("");
  const [doneFromWhere, setDoneFromWhere] = useState("");
  const [isManual, setIsManual] = useState(false);
  const [dailyLogEnabled, setDailyLogEnabled] = useState(true);
  const [dateEnabled, setDateEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setColumnName(initialData.columnName || "");
        setDescription(initialData.description || "");
        setAllocatedTo(initialData.allocatedTo || "");
        setEmail(initialData.email || "");
        setDailyLog(initialData.dailyLog || "");
        setSource(initialData.source || "");
        setDoneFromWhere(initialData.doneFromWhere || "");
        setIsManual(!!initialData.isManual);
        setDailyLogEnabled(initialData.dailyLogEnabled ?? true);
        setDateEnabled(initialData.dateEnabled ?? true);
        // initialData.date is ISO string or YYYY-MM-DD
        if (initialData.date) {
          const d = new Date(initialData.date);
          if (!isNaN(d.getTime())) {
            const iso = String(initialData.date).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) setDate(iso);
            else {
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              setDate(`${yyyy}-${mm}-${dd}`);
            }
          } else setDate("");
        } else setDate("");
      } else {
        setColumnName("");
        setDescription("");
        setAllocatedTo("");
        setEmail("");
        setDailyLog("");
        setDate("");
        setSource("");
        setDoneFromWhere("");
        setIsManual(false);
        setDailyLogEnabled(true);
        setDateEnabled(true);
      }
      setError("");
      setSaving(false);
    }
  }, [open, initialData]);

  const handleSave = async () => {
    const trimmed = columnName.trim();
    if (!trimmed) {
      setError("Column Name is required");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Invalid email");
      return;
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Invalid date");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        columnName: trimmed,
        description: description.trim() || null,
        allocatedTo: allocatedTo.trim() || null,
        email: email.trim() || null,
        dailyLog: dailyLog.trim() || null,
        date: date || null,
        source: source.trim() || null,
        doneFromWhere: doneFromWhere.trim() || null,
        isManual,
        dailyLogEnabled,
        dateEnabled,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">{isEditing ? "Edit SOP Responsibility" : "Add SOP Responsibility"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-slate-500 text-[11px] block mb-1">COLUMN NAME *</label>
            <input
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="e.g. Tender Uploading"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>
          <div>
            <label className="text-slate-500 text-[11px] block mb-1">DESCRIPTION</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description of SOP"
              rows={2}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-500 text-[11px] block mb-1">ALLOCATED TO</label>
              <input
                value={allocatedTo}
                onChange={(e) => setAllocatedTo(e.target.value)}
                placeholder="e.g. Arpan Pal"
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
            </div>
            <div>
              <label className="text-slate-500 text-[11px] block mb-1">EMAIL</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. sales@uicwires.com"
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-500 text-[11px] block mb-1">DAILY LOG</label>
            <textarea
              value={dailyLog}
              onChange={(e) => setDailyLog(e.target.value)}
              placeholder="Daily log note (optional)"
              rows={2}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-500 text-[11px] block mb-1">SOURCE</label>
              <select value={source} onChange={(e)=>{const v=e.target.value; setSource(v); if(["AI","DOCUMENT_PARSE","RA_AUTOMATION","SCRAPE_247"].includes(v)){ setDailyLogEnabled(false); setDateEnabled(false);} }} className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-accent">
                <option value="">Select source</option>
                {SOURCE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-500 text-[11px] block mb-1">DATE</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-500 text-[11px] block mb-1">DONE FROM WHERE</label>
            <input value={doneFromWhere} onChange={(e)=>setDoneFromWhere(e.target.value)} placeholder="e.g. Excel upload / Manual via TenderTable" className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-accent" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={isManual} onChange={(e)=>setIsManual(e.target.checked)} /> Manual?</label>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={dailyLogEnabled} onChange={(e)=>setDailyLogEnabled(e.target.checked)} /> DailyLog</label>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={dateEnabled} onChange={(e)=>setDateEnabled(e.target.checked)} /> Date</label>
          </div>
          {error && <p className="text-red-500 text-[12px]">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isEditing ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
