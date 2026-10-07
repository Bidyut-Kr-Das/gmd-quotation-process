"use client";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import MappingDialog from "@/components/admin/MappingDialog";
import { MERGED_FIELDS } from "@/lib/tender-columns";

interface Mapping {
  id: number;
  excelHeader: string;
  dbField: string;
  displayName: string | null;
}

interface Group {
  dbField: string;
  displayName: string | null;
  headers: { id: number; excelHeader: string }[];
}

export default function ColumnMappingsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const dbFieldOptions = useMemo(() => [...MERGED_FIELDS].sort(), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Mapping | null>(null);
  const [preSelectedDbField, setPreSelectedDbField] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const fetchMappings = useCallback(async () => {
    try {
      const res = await fetch("/api/column-mappings");
      const data = await res.json();
      setMappings(data.mappings);
    } catch {
      toast.error("Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const groups = useMemo(() => {
    const searchLower = search.toLowerCase().trim();
    const headerMap = new Map<string, { id: number; excelHeader: string }[]>();
    const displayMap = new Map<string, string>();
    for (const m of mappings) {
      if (searchLower) {
        const match =
          m.excelHeader.toLowerCase().includes(searchLower) ||
          m.dbField.toLowerCase().includes(searchLower) ||
          (m.displayName?.toLowerCase().includes(searchLower) ?? false);
        if (!match) continue;
      }
      if (!headerMap.has(m.dbField)) headerMap.set(m.dbField, []);
      headerMap.get(m.dbField)!.push({ id: m.id, excelHeader: m.excelHeader });
      if (m.displayName && !displayMap.has(m.dbField)) {
        displayMap.set(m.dbField, m.displayName);
      }
    }
    return Array.from(headerMap.entries())
      .map(([dbField, headers]) => ({
        dbField,
        displayName: displayMap.get(dbField) ?? null,
        headers,
      }))
      .sort((a, b) => a.dbField.localeCompare(b.dbField));
  }, [mappings, search]);

  async function handleDelete(id: number, excelHeader: string) {
    if (!confirm(`Remove "${excelHeader}" from mapping?`)) return;
    try {
      const res = await fetch(`/api/column-mappings/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Header removed");
      fetchMappings();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function onDialogSave(data: {
    excelHeader: string;
    dbField: string;
    displayName: string | null;
  }) {
    setSaving(true);
    try {
      let res: Response;
      if (editData) {
        res = await fetch(`/api/column-mappings/${editData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        res = await fetch("/api/column-mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      toast.success(editData ? "Mapping updated" : "Mapping created");
      fetchMappings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function openAddDialog(dbField?: string) {
    setEditData(null);
    setPreSelectedDbField(dbField);
    setDialogOpen(true);
  }

  function openEditDialog(m: Mapping) {
    setEditData(m);
    setPreSelectedDbField(undefined);
    setDialogOpen(true);
  }

  if (loading) {
    return (
      <div style={{ padding: "24px" }}>
        <h1 style={{ color: "var(--color-brand)", marginBottom: "24px" }}>
          Column Mappings
        </h1>
        <p style={{ color: "#999" }}>Loading mappings...</p>
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
          marginBottom: "24px",
        }}
      >
        <h1 style={{ color: "var(--color-brand)", margin: 0, fontSize: "22px" }}>
          Column Mappings
        </h1>
        <button
          onClick={() => openAddDialog()}
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
          <Plus size={14} /> Add Group
        </button>
      </div>

      <div
        style={{
          position: "relative",
          marginBottom: "16px",
        }}
      >
        <Search
          size={14}
          style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "#999",
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search mappings..."
          style={{
            width: "100%",
            padding: "8px 12px 8px 36px",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            fontSize: "14px",
            color: "#333",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "40px",
            textAlign: "center",
            color: "#999",
            fontSize: "14px",
          }}
        >
          {search.trim() ? "No mappings match your search." : "No mappings found. Click \"Add Group\" to create one."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {groups.map((group) => (
            <div
              key={group.dbField}
              style={{
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderRadius: "8px",
                padding: "16px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "15px",
                      fontWeight: 600,
                      color: "var(--color-brand)",
                    }}
                  >
                    {group.dbField}
                  </span>
                  {group.displayName && (
                    <>
                      <span style={{ color: "#ccc", fontSize: "13px" }}>
                        &rarr;
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          color: "#666",
                          fontStyle: "italic",
                        }}
                      >
                        {group.displayName}
                      </span>
                    </>
                  )}
                </div>

              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  alignItems: "center",
                }}
              >
                {group.headers.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      background: "#f0f4f8",
                      border: "1px solid #dde3ea",
                      borderRadius: "16px",
                      fontSize: "13px",
                      fontFamily: "monospace",
                      color: "#333",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onClick={() =>
                      openEditDialog({
                        id: h.id,
                        excelHeader: h.excelHeader,
                        dbField: group.dbField,
                        displayName: group.displayName,
                      })
                    }
                    title="Click to edit"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "#e2e8f0";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "#f0f4f8";
                    }}
                  >
                    <span>{h.excelHeader}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(h.id, h.excelHeader);
                      }}
                      title="Remove header"
                      style={{
                        padding: 0,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#999",
                        display: "inline-flex",
                        alignItems: "center",
                        lineHeight: 1,
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => openAddDialog(group.dbField)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    background: "none",
                    border: "1px dashed #ccc",
                    borderRadius: "16px",
                    cursor: "pointer",
                    color: "#888",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = "var(--color-brand)";
                    el.style.color = "var(--color-brand)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = "#ccc";
                    el.style.color = "#888";
                  }}
                >
                  <Plus size={12} /> Add Header
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p
        style={{
          marginTop: "12px",
          fontSize: "12px",
          color: "#999",
          textAlign: "center",
        }}
      >
        {mappings.length} mapping{mappings.length !== 1 ? "s" : ""} across{" "}
        {groups.length} field{groups.length !== 1 ? "s" : ""}. Click a badge to
        edit, or the ✕ to remove.
      </p>

      <MappingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={onDialogSave}
        dbFieldOptions={dbFieldOptions}
        initialData={
          editData && editData.id !== 0
            ? editData
            : null
        }
        preSelectedDbField={
          editData && editData.id === 0 ? editData.dbField : preSelectedDbField
        }
      />
    </div>
  );
}
