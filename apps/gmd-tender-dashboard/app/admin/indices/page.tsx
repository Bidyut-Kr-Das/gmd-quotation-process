"use client";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Plus, Search, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ColumnIndexDialog from "@/components/admin/ColumnIndexDialog";

interface ColumnIndex {
  id: number;
  columnName: string;
  displayOrder: number;
  displayName: string | null;
  visible: boolean;
}

export default function ColumnIndicesPage() {
  const [indices, setIndices] = useState<ColumnIndex[]>([]);
  const [allFields, setAllFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<ColumnIndex | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch("/api/column-indices");
      const data = await res.json();
      setIndices(data.indices);
    } catch {
      toast.error("Failed to load column indices");
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
    fetchIndices();
  }, [fetchIndices]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const filteredIndices = useMemo(() => {
    if (!search.trim()) return indices;
    const lower = search.toLowerCase().trim();
    return indices.filter(
      (idx) =>
        idx.columnName.toLowerCase().includes(lower) ||
        (idx.displayName ?? "").toLowerCase().includes(lower),
    );
  }, [indices, search]);

  async function handleDelete(item: ColumnIndex) {
    if (!confirm(`Remove index entry for "${item.columnName}"?`)) return;
    try {
      const res = await fetch(`/api/column-indices/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success(`Removed "${item.columnName}"`);
      fetchIndices();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function onDialogSave(data: {
    columnName: string;
    displayOrder: number;
    displayName: string | null;
    visible: boolean;
  }) {
    setSaving(true);
    try {
      let res: Response;
      if (editData) {
        res = await fetch(`/api/column-indices/${editData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        res = await fetch("/api/column-indices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      toast.success(editData ? "Column index updated" : "Column index created");
      fetchIndices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "24px" }}>
        <h1 style={{ color: "var(--color-brand)", marginBottom: "24px" }}>
          Column Index
        </h1>
        <p style={{ color: "#999" }}>Loading column indices...</p>
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
        <h1 style={{ color: "var(--color-brand)", margin: 0, fontSize: "22px" }}>
          Column Index
        </h1>
        <button
          onClick={() => {
            setEditData(null);
            setDialogOpen(true);
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
          <Plus size={14} /> Add Column
        </button>
      </div>

      <div style={{ position: "relative", marginBottom: "16px" }}>
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
          placeholder="Search by column name or display name..."
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

      {filteredIndices.length === 0 ? (
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
          {search.trim()
            ? "No column indices match your search."
            : "No column indices configured. Click \"Add Column\" to create one."}
        </div>
      ) : (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "60px 2fr 2fr 100px 120px",
              gap: "8px",
              padding: "10px 16px",
              background: "#f8f9fb",
              borderBottom: "1px solid #e0e0e0",
              fontSize: "12px",
              fontWeight: 600,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <span>#</span>
            <span>Column Name</span>
            <span>Display Name</span>
            <span>Index</span>
            <span style={{ textAlign: "center" }}>Actions</span>
          </div>
          {filteredIndices.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 2fr 2fr 100px 120px",
                gap: "8px",
                padding: "8px 16px",
                borderBottom: "1px solid #f0f0f0",
                alignItems: "center",
                fontSize: "13px",
                background: idx % 2 === 0 ? "#fff" : "#fafafa",
              }}
            >
              <span style={{ color: "#bbb", fontSize: "12px" }}>
                {idx + 1}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: "var(--color-brand)",
                }}
              >
                {item.columnName}
              </span>
              <span style={{ color: "#666", fontSize: "12px" }}>
                {item.displayName ?? "-"}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "13px",
                  color: "#333",
                  fontWeight: 600,
                }}
              >
                {item.displayOrder}
              </span>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={() => {
                    setEditData(item);
                    setDialogOpen(true);
                  }}
                  title="Edit"
                  style={{
                    padding: "6px 10px",
                    background: "none",
                    border: "1px solid #e0e0e0",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#666",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                  }}
                >
                  <Pencil size={12} /> Edit
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  title="Delete"
                  style={{
                    padding: "6px 10px",
                    background: "none",
                    border: "1px solid #e0e0e0",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#d32f2f",
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

      <p
        style={{
          marginTop: "12px",
          fontSize: "12px",
          color: "#999",
          textAlign: "center",
        }}
      >
        {indices.length} column{indices.length !== 1 ? "s" : ""} configured.
        Columns with the same index are sorted by creation date.
      </p>

      <ColumnIndexDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={onDialogSave}
        fieldOptions={allFields}
        initialData={
          editData
            ? {
                columnName: editData.columnName,
                displayOrder: editData.displayOrder,
                displayName: editData.displayName,
                visible: editData.visible,
              }
            : null
        }
      />
    </div>
  );
}
