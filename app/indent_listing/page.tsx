"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import GMDUpdateHeader from "@/components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateSkeleton from "@/components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import IndentListingTable from "@/components/indent_listing/IndentListingTable";
import { recomputeIndentListingVersionsAction } from "@/app/actions";

const STATUS_IDX = 3;

interface IndentListingData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

export default function IndentListingPage() {
  const [data, setData] = useState<IndentListingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/indent-listing");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    const toastId = toast.loading("Syncing from Contract Review...");
    try {
      const res = await fetch("/api/indent-listing/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      const result = await res.json();
      const merged = Number(result.merged ?? 0);
      const normalized = Number(result.canonicalized ?? 0);
      const pruned = Number(result.pruned ?? 0);
      const skippedNonLive = Number(result.skippedNonLive ?? 0);
      const details = [
        merged > 0 ? `${merged} merged` : null,
        normalized - merged > 0 ? `${normalized - merged} PN normalized` : null,
        pruned > 0 ? `${pruned} non-live removed` : null,
        skippedNonLive > 0 ? `${skippedNonLive} non-live rows skipped` : null,
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(
        `Synced: ${result.created} created, ${result.updated} updated${details ? `, ${details}` : ""}`,
        { id: toastId },
      );
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed", {
        id: toastId,
      });
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const handleRecompute = useCallback(async () => {
    setSyncing(true);
    setError(null);
    const toastId = toast.loading(
      "Recomputing V1-V4, RM codes and cost code ref from Item...",
    );
    try {
      const res = await recomputeIndentListingVersionsAction();
      if (!res?.success) {
        throw new Error(res?.error ?? "Recompute failed");
      }
      const rm = res.data?.rmCode;
      const rmCodeDetail = rm
        ? ` | RM codes: ${rm.resolved} linked, ${rm.ambiguous} multi, ${rm.unmatched} unmatched`
        : "";
      const costRef = res.data?.costCodeRef;
      const costRefDetail = costRef
        ? ` | Cost code ref: ${costRef.resolved} filled, ${costRef.ambiguous} multi, ${costRef.unmatched} unmatched, ${costRef.skippedNoIndent} no indent row`
        : "";
      toast.success(
        `Recomputed: ${res.data?.updated ?? 0} updated, ${res.data?.deleted ?? 0} merged/deleted${rmCodeDetail}${costRefDetail}`,
        { id: toastId },
      );
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed", {
        id: toastId,
      });
      setError(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const allRows = data?.rows ?? [];
  const allIds = data?.ids ?? [];
  const partition = (status: string) => {
    const rows: unknown[][] = [];
    const ids: string[] = [];
    allRows.forEach((r, i) => {
      if (String(r[STATUS_IDX] ?? "").trim().toLowerCase() === status) {
        rows.push(r);
        ids.push(allIds[i]);
      }
    });
    return { rows, ids };
  };
  const received = partition("received");
  const pending = partition("pending");

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <GMDUpdateHeader
          title="INDENT CHECKING"
          totalRows={0}
          syncedAt={undefined}
        />
        <GMDUpdateSkeleton />
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader
        title="INDENT CHECKING"
        totalRows={data?.totalRows ?? 0}
        syncedAt={data?.syncedAt ?? undefined}
      />
      <div className="px-6 py-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {syncing ? "Syncing..." : "Sync from Contract Review"}
        </button>
        <button
          type="button"
          onClick={handleRecompute}
          disabled={syncing}
          className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {syncing ? "Working..." : "Recompute V1-V4"}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
      <div className="flex-1 min-h-0 px-6 pb-6 flex gap-4">
        <IndentListingTable
          title="MC RECEIVED"
          rows={received.rows}
          ids={received.ids}
        />
        <IndentListingTable
          title="MC PENDING"
          rows={pending.rows}
          ids={pending.ids}
        />
      </div>
    </main>
  );
}