"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  Circle,
  Loader2,
  Merge as MergeIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import type { TenderMergedRow } from "@/lib/slices/tendersSlice";
import { updateTenderMergedField } from "@/lib/slices/tendersSlice";
import {
  collectAutoFillUpdates,
  computeConflicts,
  isSingleSelectField,
  normalizeValue,
  rowLabel,
} from "./conflictUtils";

interface ConflictDetailsDialogProps {
  docketNo: string;
  onClose: () => void;
}

export default function ConflictDetailsDialog({
  docketNo,
  onClose,
}: ConflictDetailsDialogProps) {
  const dispatch = useAppDispatch();

  const docketRows = useAppSelector((s) => s.tenders.data?.rows);
  const rows = useMemo(
    () =>
      docketRows?.filter((r) => String(r.docketNo ?? "").trim() === docketNo) ??
      [],
    [docketRows, docketNo],
  );

  const conflicts = useMemo(() => computeConflicts(rows), [rows]);
  const labels = useMemo(() => rows.map(rowLabel), [rows]);
  const conflictFields = useMemo(
    () => new Set(conflicts.map((c) => c.field)),
    [conflicts],
  );

  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected((prev) => {
      if (rows.length === 0) return prev;
      const next: Record<string, Set<number>> = {};
      let changed = false;
      for (const [field, set] of Object.entries(prev)) {
        if (conflictFields.has(field)) {
          next[field] = set;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [conflictFields, rows.length]);

  const targetRowIndex = useMemo(() => {
    const refSet = selected["referenceNo"];
    if (refSet && refSet.size > 0) return [...refSet][0];
    return 0;
  }, [selected]);

  const targetRow = rows[targetRowIndex];

  const toggleValue = useCallback((field: string, rowIndex: number) => {
    setSelected((prev) => {
      const cur = prev[field] ?? new Set<number>();
      const next = new Set(cur);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        if (isSingleSelectField(field)) next.clear();
        next.add(rowIndex);
      }
      return { ...prev, [field]: next };
    });
  }, []);

  const mergedValueFor = useCallback(
    (field: string): string => {
      const set = selected[field];
      if (!set || set.size === 0) return "";
      return [...set]
        .sort((a, b) => a - b)
        .map((i) => normalizeValue(rows[i][field]))
        .filter(Boolean)
        .join("");
    },
    [selected, rows],
  );

  const tickedFields = useMemo(
    () =>
      Object.keys(selected).filter(
        (f) => f !== "referenceNo" && (selected[f]?.size ?? 0) > 0,
      ),
    [selected],
  );

  const autoFillUpdates = useMemo(
    () =>
      targetRow
        ? collectAutoFillUpdates(
            targetRow,
            rows,
            new Set([...tickedFields, "referenceNo"]),
          )
        : [],
    [targetRow, rows, tickedFields],
  );

  const tickedUpdates = useMemo(
    () =>
      tickedFields
        .map((field) => ({ field, value: mergedValueFor(field) }))
        .filter((u) => u.value !== ""),
    [tickedFields, mergedValueFor],
  );

  const totalUpdates = tickedUpdates.length + autoFillUpdates.length;
  const canMerge = totalUpdates > 0 && !saving;

  const handleMerge = useCallback(async () => {
    if (!targetRow) return;
    const targetId = Number(targetRow.id);

    const updates = [...tickedUpdates, ...autoFillUpdates];
    if (updates.length === 0) return;

    setSaving(true);
    let failed = 0;
    for (const u of updates) {
      try {
        await dispatch(
          updateTenderMergedField({
            rowIndex: targetRowIndex,
            field: u.field,
            value: u.value,
            tenderMergedId: targetId,
            oldValue: String(targetRow[u.field] ?? ""),
          }),
        ).unwrap();
      } catch {
        failed += 1;
      }
    }
    setSaving(false);

    if (failed > 0) {
      toast.error(
        `Merged ${updates.length - failed} of ${updates.length} fields (${failed} failed)`,
      );
    } else {
      toast.success(
        `Merged ${updates.length} field${updates.length === 1 ? "" : "s"} for docket #${docketNo}`,
      );
    }
  }, [
    dispatch,
    targetRow,
    targetRowIndex,
    tickedUpdates,
    autoFillUpdates,
    docketNo,
  ]);

  if (rows.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Conflicts — Docket #{docketNo}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-slate-400">No tenders found in this docket.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-800 truncate">
              Conflicts — Docket #{docketNo}
            </h3>
            <span className="text-xs text-slate-400 shrink-0">
              ({rows.length} tenders)
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {conflicts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-16 text-sm text-slate-400">
            No field conflicts found in this docket.
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-40">
                    Field
                  </th>
                  {labels.map((label, idx) => {
                    const isTarget = idx === targetRowIndex;
                    return (
                      <th
                        key={`${label}-${idx}`}
                        className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-600 border-b border-slate-200 ${
                          isTarget ? "bg-brand-light" : ""
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {isTarget && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-brand text-white">
                              Target
                            </span>
                          )}
                          <span>{label}</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-56">
                    Merged Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((conflict) => {
                  const field = conflict.field;
                  const isSingle = isSingleSelectField(field);
                  const mergedValue = mergedValueFor(field);
                  return (
                    <tr
                      key={field}
                      className="border-b border-slate-100 align-top"
                    >
                      <td className="px-4 py-2.5 text-[13px] font-medium text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <span>{field}</span>
                          {isSingle && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              single
                            </span>
                          )}
                        </div>
                      </td>
                      {conflict.values.map((entry, idx) => {
                        const isEmpty = entry.value === "";
                        const isSelected = selected[field]?.has(idx) ?? false;
                        const isTarget = idx === targetRowIndex;
                        return (
                          <td
                            key={`${field}-${idx}`}
                            className={`px-4 py-2.5 text-[13px] ${
                              isTarget ? "bg-brand-light" : ""
                            }`}
                          >
                            {isEmpty ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleValue(field, idx)}
                                  title={
                                    isSelected
                                      ? "Remove from merge"
                                      : "Include in merge"
                                  }
                                  className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors ${
                                    isSelected
                                      ? "bg-brand border-brand text-white"
                                      : "bg-white border-slate-300 text-slate-400 hover:border-brand-accent hover:text-brand-accent"
                                  }`}
                                >
                                  {isSelected ? (
                                    <Check className="w-3 h-3" />
                                  ) : (
                                    <Circle className="w-3 h-3" />
                                  )}
                                </button>
                                <span
                                  className={`whitespace-pre-wrap break-words ${
                                    isSelected
                                      ? "text-brand font-medium"
                                      : "bg-amber-50 text-amber-900 font-medium"
                                  }`}
                                >
                                  {entry.value}
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-[13px] whitespace-pre-wrap break-words text-slate-700">
                        {mergedValue !== "" ? (
                          <span className="inline-block bg-brand-light text-brand font-medium px-2 py-0.5 rounded">
                            {mergedValue}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
          <div className="text-xs text-slate-500 min-w-0">
            {conflicts.length} conflicting field
            {conflicts.length === 1 ? "" : "s"}
            <span className="text-slate-300 mx-2">|</span>
            {totalUpdates > 0 ? (
              <span>
                Will write {totalUpdates} field
                {totalUpdates === 1 ? "" : "s"} to{" "}
                <span className="font-semibold text-slate-700">
                  {targetRow ? rowLabel(targetRow) : "-"}
                </span>
                {autoFillUpdates.length > 0 && (
                  <span className="text-slate-400">
                    {" "}
                    ({autoFillUpdates.length} auto-fill)
                  </span>
                )}
              </span>
            ) : (
              <span>Select values to merge</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 text-[13px] text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-white transition-colors disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={handleMerge}
              disabled={!canMerge}
              className="px-4 py-1.5 text-[13px] text-white bg-brand rounded-md hover:bg-brand-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MergeIcon className="w-3.5 h-3.5" />
              )}
              {saving ? "Merging..." : "Merge"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
