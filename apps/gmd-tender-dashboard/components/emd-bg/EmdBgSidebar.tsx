"use client";

import { BadgeCheck, Clock, ShieldCheck, Users, IndianRupee, Hash, AlertTriangle, Mail } from "lucide-react";

export type EmdBgStatus = "RUNNING" | "EXPIRED" | "CLOSED" | "OTHER";

export interface EmdBgStats {
  count: number;
  totalBgAmt: number;
  partyCount: number;
  emailAvailableCount: number;
  emailAvailablePartyCount: number;
}

const STATUS_META: Record<EmdBgStatus, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  RUNNING: { label: "Running", icon: ShieldCheck, color: "#137333", bg: "#e6f4ea", border: "#a8d5b5" },
  EXPIRED: { label: "Expired", icon: Clock, color: "#b06000", bg: "#fef7e0", border: "#f5d76e" },
  CLOSED: { label: "Closed", icon: BadgeCheck, color: "var(--color-brand-accent)", bg: "var(--color-brand-light)", border: "var(--color-brand-light)" },
  OTHER: { label: "Other", icon: AlertTriangle, color: "#5f6368", bg: "#f1f3f4", border: "#dadce0" },
};

function formatCurrency(n: number) {
  if (!n) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

interface Props {
  stats: Record<EmdBgStatus, EmdBgStats>;
  selected: EmdBgStatus | "ALL";
  onSelect: (s: EmdBgStatus | "ALL") => void;
  totalRows: number;
  totalEmailCustomers?: number;
  totalEmailRecords?: number;
}

export function EmdBgSidebar({ stats, selected, onSelect, totalRows, totalEmailCustomers, totalEmailRecords }: Props) {
  const allBgAmt = (Object.values(stats) as EmdBgStats[]).reduce((a, b) => a + b.totalBgAmt, 0);
  const allEmailCustomers = totalEmailCustomers ?? (Object.values(stats) as EmdBgStats[]).reduce((a, b) => a + b.emailAvailablePartyCount, 0);
  const allEmailRecords = totalEmailRecords ?? (Object.values(stats) as EmdBgStats[]).reduce((a, b) => a + b.emailAvailableCount, 0);
  const statuses: EmdBgStatus[] = ["RUNNING", "EXPIRED", "CLOSED", "OTHER"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: selected === "ALL" ? "var(--color-brand)" : "rgba(255,255,255,0.7)" }}>All BGs</span>
          <span style={{ fontSize: "11px", fontWeight: 700, background: selected === "ALL" ? "var(--color-brand-light)" : "rgba(255,255,255,0.12)", color: selected === "ALL" ? "var(--color-brand-accent)" : "rgba(255,255,255,0.8)", padding: "2px 8px", borderRadius: "12px" }}>{totalRows}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: selected === "ALL" ? "#5f6368" : "rgba(255,255,255,0.6)" }}>
            <Hash size={12} /> Records: <strong style={{ color: selected === "ALL" ? "var(--color-brand)" : "#fff" }}>{totalRows}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: selected === "ALL" ? "#5f6368" : "rgba(255,255,255,0.6)" }}>
            <IndianRupee size={12} /> Total BG Amt: <strong style={{ color: selected === "ALL" ? "var(--color-brand)" : "#fff" }}>{formatCurrency(allBgAmt)}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: selected === "ALL" ? "#5f6368" : "rgba(255,255,255,0.6)" }}>
            <Mail size={12} /> Email Available: <strong style={{ color: selected === "ALL" ? "var(--color-brand)" : "#fff" }}>{allEmailRecords}</strong>
            <span style={{ opacity: 0.7 }}>({allEmailCustomers} customers)</span>
          </div>
        </div>
      </button>

      {statuses.map((key) => {
        const meta = STATUS_META[key];
        const s = stats[key];
        const Icon = meta.icon;
        const isSelected = selected === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(isSelected ? "ALL" : key)}
            style={{
              textAlign: "left",
              background: isSelected ? "#ffffff" : "rgba(255,255,255,0.06)",
              border: isSelected ? `2px solid ${meta.color}` : "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "12px 14px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{ width: "28px", height: "28px", borderRadius: "8px", background: isSelected ? meta.bg : "rgba(255,255,255,0.10)", border: `1px solid ${isSelected ? meta.border : "rgba(255,255,255,0.12)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: isSelected ? meta.color : "rgba(255,255,255,0.85)" }}>
                <Icon size={14} />
              </span>
              <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.4px", textTransform: "uppercase", color: isSelected ? "var(--color-brand)" : "#ffffff" }}>{meta.label}</span>
              <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, background: isSelected ? meta.bg : "rgba(255,255,255,0.12)", color: isSelected ? meta.color : "rgba(255,255,255,0.9)", border: `1px solid ${isSelected ? meta.border : "transparent"}`, padding: "2px 8px", borderRadius: "12px" }}>{s.count}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: isSelected ? "#5f6368" : "rgba(255,255,255,0.6)" }}><Users size={12} /> Parties</span>
                <strong style={{ color: isSelected ? "var(--color-brand)" : "#fff", fontSize: "12px" }}>{s.partyCount}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: isSelected ? "#5f6368" : "rgba(255,255,255,0.6)" }}><IndianRupee size={12} /> Total BG</span>
                <strong style={{ color: isSelected ? "var(--color-brand)" : "#fff", fontSize: "12px" }}>{formatCurrency(s.totalBgAmt)}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: isSelected ? "#5f6368" : "rgba(255,255,255,0.6)" }}><Hash size={12} /> Records</span>
                <strong style={{ color: isSelected ? "var(--color-brand)" : "#fff", fontSize: "12px" }}>{s.count}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: isSelected ? "#5f6368" : "rgba(255,255,255,0.6)" }}><Mail size={12} /> Email Available</span>
                <strong style={{ color: isSelected ? "var(--color-brand)" : "#fff", fontSize: "12px" }}>{s.emailAvailableCount} <span style={{ fontWeight: 400, opacity: 0.7, fontSize: "10px" }}>({s.emailAvailablePartyCount} cust)</span></strong>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
