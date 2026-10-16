"use client";
import React, { useState } from "react";
import Link from "next/link";
import { RefreshCw, Columns, ListOrdered, GitMerge, ClipboardList, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

export default function AdminPage() {
  const { data: session } = useSession();
  const canSync = session?.user?.role === "admin" || session?.user?.role === "developer";
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const handleRefreshAll = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/refresh-all", { method: "POST" });
      const data = await res.json();
      setSyncResult(data.success ? "Sync completed successfully." : `Sync failed: ${data.error}`);
    } catch (err) {
      setSyncResult(`Error: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const ok = syncResult?.startsWith("Sync completed");

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 lg:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure how uploaded tender sheets map into the dashboard.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {ADMIN_SECTIONS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 rounded-[10px] border border-border bg-card p-4 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{description}</span>
              </span>
              <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>

        <section className="rounded-[10px] border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Data synchronisation</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Pull the latest data from Google Sheets, Smartsheet and Supply History, then update the database.
          </p>
          {canSync && (
            <Button className="mt-4" onClick={handleRefreshAll} disabled={syncing}>
              <RefreshCw className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Syncing all sources..." : "Refresh all data"}
            </Button>
          )}
          {syncResult && (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}
            >
              {syncResult}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

const ADMIN_SECTIONS = [
  { href: "/admin/mappings", label: "Column mappings", description: "Map Excel headers to DB fields", icon: Columns },
  { href: "/admin/indices", label: "Column order", description: "Reorder and configure columns", icon: ListOrdered },
  { href: "/admin/merging", label: "Column merging", description: "Merge multiple fields into one", icon: GitMerge },
  { href: "/admin/sop", label: "SOP responsibilities", description: "Manage SOP columns and daily logs", icon: ClipboardList },
];
