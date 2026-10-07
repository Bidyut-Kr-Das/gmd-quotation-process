"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { fetchCredentials, createCredential } from "@/lib/slices/credentialsSlice";
import CredentialsTable from "@/components/CredentialsTable";
import { CredentialsSidebar, CategoryStat } from "@/components/CredentialsSidebar";
import { Eraser, Eye, EyeOff } from "lucide-react";
import { DataErrorState, DataLoadingState, RefreshingBar } from "@/components/ui/data-state";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "@/app/SupplyHistory.css";

import { CATEGORY_OPTIONS, STATE_OPTIONS } from "@/lib/credentialsOptions";

export default function CredentialsPage() {
  const dispatch = useAppDispatch();
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "admin" || session?.user?.role === "developer";
  const { data, loading, refreshing, error, creating } = useAppSelector((s) => s.credentials);
  const [selectedCategory, setSelectedCategory] = useState<string | "ALL">("ALL");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string>>({ category: "", states: "", websites: "", password: "", mobileNo: "", profilePassword: "", dscName: "", dscPassword: "", otherRef: "" });
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});

  useEffect(() => {
    dispatch(fetchCredentials());
  }, [dispatch]);

  const categoryStats: CategoryStat[] = useMemo(() => {
    const map = new Map<string, { display: string; count: number }>();
    for (const r of data) {
      const raw = r.category?.trim() || "";
      const key = raw || "(Uncategorized)";
      const display = raw || "(Uncategorized)";
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { display, count: 1 });
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, display: v.display, count: v.count }))
      .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
  }, [data]);

  const filteredCount = useMemo(() => {
    if (selectedCategory === "ALL") return data.length;
    return data.filter((r) => (r.category?.trim() || "(Uncategorized)") === selectedCategory).length;
  }, [data, selectedCategory]);

  const handleRetry = () => {
    dispatch(fetchCredentials({ force: true }));
  };

  const handleAdd = async () => {
    const payload: Record<string, string | null> = {};
    for (const k of Object.keys(addForm)) {
      const v = addForm[k].trim();
      payload[k] = v === "" ? null : v;
    }
    if (!Object.values(payload).some((v) => v !== null)) {
      toast.error("Fill at least one field");
      return;
    }
    try {
      await dispatch(createCredential(payload)).unwrap();
      toast.success("Credential created");
      setShowAdd(false);
      setAddForm({ category: "", states: "", websites: "", password: "", mobileNo: "", profilePassword: "", dscName: "", dscPassword: "", otherRef: "" });
    } catch (e: any) {
      toast.error(e || "Failed to create");
    }
  };

  if (loading && data.length === 0) {
    return <DataLoadingState label="Loading credentials..." />;
  }
  if (error && data.length === 0) {
    return <DataErrorState message={error} onRetry={handleRetry} />;
  }

  return (
    <div className="supply-layout-container" style={{ height: "calc(100vh - 42px)", position: "relative" }}>
      <RefreshingBar active={refreshing} />
      <aside className="supply-sidebar">
        <div className="supply-sidebar-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Categories</span>
          <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.12)", padding: "2px 6px", borderRadius: "10px" }}>{data.length} rows</span>
        </div>
        <div className="supply-sidebar-body">
          <CredentialsSidebar stats={categoryStats} totalRows={data.length} selected={selectedCategory} onSelect={setSelectedCategory} onAdd={canEdit ? () => setShowAdd(true) : undefined} canEdit={canEdit} />
        </div>
        <div className="supply-sidebar-footer">
          <button className="supply-refresh-sidebar-btn" onClick={() => setSelectedCategory("ALL")}>
            <Eraser size={14} /> Clear Filter
          </button>
        </div>
      </aside>
      <div className="supply-workspace">
        <header className="supply-top-header">
          <div className="supply-header-brand">
            <h1 className="supply-header-title">LINKS <span>& PASSWORDS</span></h1>
            <div className="supply-header-divider" />
            <span className="supply-header-subtitle">{selectedCategory === "ALL" ? "All Categories" : selectedCategory} — {filteredCount} of {data.length} records</span>
          </div>
          <div className="supply-header-actions">
            {selectedCategory !== "ALL" && <span className="supply-record-badge">{selectedCategory}</span>}
          </div>
        </header>
        <main className="supply-body" style={{ padding: "12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <CredentialsTable selectedCategory={selectedCategory} onAdd={canEdit ? () => setShowAdd(true) : undefined} canEdit={canEdit} />
        </main>
      </div>
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={() => setShowAdd(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "8px", padding: "24px", width: "720px", maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px", color: "var(--color-brand)" }}>Add Credential</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {["category", "states", "websites", "password", "mobileNo", "profilePassword", "dscName", "dscPassword", "otherRef"].map((k) => (
                <div key={k} style={{ display: "flex", flexDirection: "column", gap: "4px", gridColumn: k === "otherRef" || k === "websites" ? "span 2" : "span 1" }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#475569" }}>{k}</label>
                  {k === "category" ? (
                    <Select value={addForm[k] || ""} onValueChange={(v: string | null) => setAddForm((p) => ({ ...p, [k]: v ?? "" }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent className="w-full max-w-none">
                        {CATEGORY_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : k === "states" ? (
                    <Select value={addForm[k] || ""} onValueChange={(v: string | null) => setAddForm((p) => ({ ...p, [k]: v ?? "" }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent className="w-full max-w-none">
                        {STATE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : k === "otherRef" ? (
                    <textarea value={addForm[k]} onChange={(e) => setAddForm((p) => ({ ...p, [k]: e.target.value }))} rows={2} placeholder={k} style={{ padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px" }} />
                  ) : k.toLowerCase().includes("password") ? (
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        value={addForm[k]}
                        onChange={(e) => setAddForm((p) => ({ ...p, [k]: e.target.value }))}
                        placeholder={k}
                        type={showPwd[k] ? "text" : "password"}
                        style={{ flex: 1, padding: "8px 32px 8px 8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px", width: "100%" }}
                      />
                      <button type="button" onClick={() => setShowPwd((p) => ({ ...p, [k]: !p[k] }))} style={{ position: "absolute", right: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px", border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}>
                        {showPwd[k] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  ) : (
                    <input value={addForm[k]} onChange={(e) => setAddForm((p) => ({ ...p, [k]: e.target.value }))} placeholder={k} type="text" style={{ padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px" }} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "20px" }}>
              <button onClick={() => setShowAdd(false)} disabled={creating} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff" }}>Cancel</button>
              <button onClick={handleAdd} disabled={creating} style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "var(--color-brand)", color: "#fff", fontWeight: 600, opacity: creating ? 0.6 : 1 }}>{creating ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
