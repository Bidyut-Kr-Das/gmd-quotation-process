"use client";
import { DataLoadingState } from "@/components/ui/data-state";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import MergedColumnDialog from "@/components/admin/MergedColumnDialog";
import { MERGED_FIELDS } from "@/lib/tender-columns";

export default function ColumnMergingPage() {
  const [columnGroups, setColumnGroups] = useState<{
    id: number;
    label: string;
    separator: string;
    fields: string[];
  }[]>([]);
  const [allFields, setAllFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const mergeFieldOptions = useMemo(
    () => (allFields.length ? allFields : [...MERGED_FIELDS].sort()),
    [allFields],
  );

  const [mergedDialogOpen, setMergedDialogOpen] = useState(false);
  const [mergedEditData, setMergedEditData] = useState<{
    id: number;
    label: string;
    separator: string;
    fields: string[];
  } | null>(null);
  const [savingMerged, setSavingMerged] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/column-groups");
      const data = await res.json();
      setColumnGroups(
        (data.groups || []).map((g: { id: number; label: string; separator: string; fields: string }) => ({
          id: g.id,
          label: g.label,
          separator: g.separator,
          fields: JSON.parse(g.fields),
        })),
      );
    } catch {
      toast.error("Failed to load merged columns");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFields = useCallback(async () => {
    try {
      const res = await fetch("/api/column-fields");
      const data = await res.json();
      if (data.fields) setAllFields(data.fields);
    } catch {}
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  async function handleDeleteGroup(id: number, label: string) {
    if (!confirm(`Remove merged column "${label}"?`)) return;
    try {
      const res = await fetch(`/api/column-groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Merged column removed");
      fetchGroups();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function onMergedDialogSave(data: {
    label: string;
    separator: string;
    fields: string[];
  }) {
    setSavingMerged(true);
    try {
      let res: Response;
      if (mergedEditData) {
        res = await fetch(`/api/column-groups/${mergedEditData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        res = await fetch("/api/column-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      toast.success(mergedEditData ? "Merged column updated" : "Merged column created");
      fetchGroups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      throw err;
    } finally {
      setSavingMerged(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "24px" }}>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Column Merging
        </h1>
        <DataLoadingState label="Loading merged columns..." />
      </div>
    );
  }

  return (
    <div className="w-full" style={{ padding: "24px", margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Column Merging
        </h1>
        <button
          onClick={() => {
            setMergedEditData(null);
            setMergedDialogOpen(true);
          }}
          style={{
            padding: "8px 16px",
            background: "var(--color-brand)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Plus size={14} /> Add Merged Column
        </button>
      </div>

      {columnGroups.length === 0 ? (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "32px",
            textAlign: "center",
            color: "var(--muted-foreground)",
            fontSize: "14px",
          }}
        >
          No merged columns configured. Fields merged here will display as a
          single column in the tender table.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {columnGroups.map((group) => (
            <div
              key={group.id}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--color-brand)",
                    }}
                  >
                    {group.label}
                  </span>
                  <span style={{ color: "var(--muted-foreground)", fontSize: "12px" }}>
                    (separator: &quot;{group.separator}&quot;)
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {group.fields.map((f) => (
                    <span
                      key={f}
                      style={{
                        padding: "2px 8px",
                        background: "var(--muted)",
                        border: "1px solid #dde3ea",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => {
                    setMergedEditData(group);
                    setMergedDialogOpen(true);
                  }}
                  title="Edit"
                  style={{
                    padding: "6px 10px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "var(--muted-foreground)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteGroup(group.id, group.label)}
                  title="Delete"
                  style={{
                    padding: "6px 10px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "var(--destructive)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                  }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MergedColumnDialog
        open={mergedDialogOpen}
        onClose={() => setMergedDialogOpen(false)}
        onSave={onMergedDialogSave}
        dbFieldOptions={mergeFieldOptions}
        initialData={
          mergedEditData
            ? {
                label: mergedEditData.label,
                separator: mergedEditData.separator,
                fields: mergedEditData.fields,
              }
            : null
        }
      />
    </div>
  );
}
