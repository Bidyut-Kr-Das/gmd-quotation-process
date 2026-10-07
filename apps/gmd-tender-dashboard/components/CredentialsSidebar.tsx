"use client";

import { Tag, Layers, Hash, Plus } from "lucide-react";

export interface CategoryStat {
  key: string;
  display: string;
  count: number;
}

interface Props {
  stats: CategoryStat[];
  totalRows: number;
  selected: string | "ALL";
  onSelect: (c: string | "ALL") => void;
  onAdd?: () => void;
  canEdit?: boolean;
}

export function CredentialsSidebar({ stats, totalRows, selected, onSelect, onAdd, canEdit = true }: Props) {
  const showAdd = !!onAdd && canEdit;
  const totalCategories = stats.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {showAdd && onAdd && (
        <button
          onClick={onAdd}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "10px 14px",
            background: "#ffffff",
            color: "var(--color-brand)",
            border: "1px solid #e1e6eb",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add Entry
        </button>
      )}
      <button
        onClick={() => onSelect("ALL")}
        style={{
          textAlign: "left",
          background: selected === "ALL" ? "#ffffff" : "rgba(255,255,255,0.06)",
          border: selected === "ALL" ? "2px solid var(--color-brand-accent)" : "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          padding: "14px",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: selected === "ALL" ? "var(--color-brand)" : "rgba(255,255,255,0.7)" }}>All Categories</span>
          <span style={{ fontSize: "11px", fontWeight: 700, background: selected === "ALL" ? "var(--color-brand-light)" : "rgba(255,255,255,0.12)", color: selected === "ALL" ? "var(--color-brand-accent)" : "rgba(255,255,255,0.8)", padding: "2px 8px", borderRadius: "12px" }}>{totalRows}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: selected === "ALL" ? "#5f6368" : "rgba(255,255,255,0.6)" }}>
            <Hash size={12} /> Records: <strong style={{ color: selected === "ALL" ? "var(--color-brand)" : "#fff" }}>{totalRows}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: selected === "ALL" ? "#5f6368" : "rgba(255,255,255,0.6)" }}>
            <Layers size={12} /> Categories: <strong style={{ color: selected === "ALL" ? "var(--color-brand)" : "#fff" }}>{totalCategories}</strong>
          </div>
        </div>
      </button>

      {stats.map((s) => {
        const isSelected = selected === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onSelect(isSelected ? "ALL" : s.key)}
            style={{
              textAlign: "left",
              background: isSelected ? "#ffffff" : "rgba(255,255,255,0.06)",
              border: isSelected ? "2px solid var(--color-brand)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "12px 14px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span style={{ width: "28px", height: "28px", borderRadius: "8px", background: isSelected ? "var(--color-brand-light)" : "rgba(255,255,255,0.10)", border: `1px solid ${isSelected ? "var(--color-brand-light)" : "rgba(255,255,255,0.12)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: isSelected ? "var(--color-brand)" : "rgba(255,255,255,0.85)" }}>
                <Tag size={14} />
              </span>
              <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.3px", color: isSelected ? "var(--color-brand)" : "#ffffff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.display}>{s.display}</span>
              <span style={{ fontSize: "11px", fontWeight: 700, background: isSelected ? "var(--color-brand-light)" : "rgba(255,255,255,0.12)", color: isSelected ? "var(--color-brand)" : "rgba(255,255,255,0.9)", border: "1px solid transparent", padding: "2px 8px", borderRadius: "12px", flexShrink: 0 }}>{s.count}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: isSelected ? "#5f6368" : "rgba(255,255,255,0.6)" }}><Hash size={12} /> Records</span>
              <strong style={{ color: isSelected ? "var(--color-brand)" : "#fff", fontSize: "12px" }}>{s.count}</strong>
            </div>
          </button>
        );
      })}

      {stats.length === 0 && (
        <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>No categories yet</div>
      )}
    </div>
  );
}
