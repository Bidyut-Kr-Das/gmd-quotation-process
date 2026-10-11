"use client";

import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

type SyncResult =
  | { tabKey: string; ok: true; totalRows: number; syncedAt: string }
  | { tabKey: string; ok: false; error: string };

/**
 * Header "Sync" button — pulls one tab from the Google Sheet into Postgres,
 * then asks the panel to re-read it from the database.
 *
 * Sits in the table's maroon header, replacing the old Refresh control. It
 * syncs only the tab it belongs to (`?tab=<key>`), so the cooldown is per-tab
 * and syncing one table cannot block another.
 *
 * The endpoint is intentionally ungated, so this handles the cooldown response
 * (429) and per-tab failure (207) gracefully rather than as a hard error.
 */
export default function SyncButton({
  tabKey,
  onSynced,
}: {
  tabKey: string;
  onSynced?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleSync = async () => {
    setBusy(true);
    const toastId = toast.loading("Syncing…");
    try {
      const res = await fetch(
        `/api/engineering-data/sync?tab=${encodeURIComponent(tabKey)}`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as
        | { error?: string; retryAfterMs?: number; results?: SyncResult[] }
        | null;

      // The cooldown is informational, not a failure: the data is already fresh.
      if (res.status === 429) {
        toast.info("Already synced a moment ago.", { id: toastId });
        return;
      }

      if (!res.ok && res.status !== 207) {
        throw new Error(body?.error ?? `Sync failed (${res.status}).`);
      }

      const result = body?.results?.[0];
      if (result && !result.ok) {
        throw new Error(result.error);
      }

      toast.success(
        result?.ok
          ? `Synced ${result.totalRows.toLocaleString("en-IN")} rows.`
          : "Synced.",
        { id: toastId },
      );

      // Ask the panel to re-read from the database, which now holds the new rows.
      onSynced?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not sync from the sheet.",
        { id: toastId },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={busy}
      className="flex items-center gap-1.5 rounded border border-white/25 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
      title="Pull the latest values for this table from the Google Sheet"
    >
      {busy ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <RefreshCw size={12} />
      )}
      {busy ? "Syncing…" : "Sync"}
    </button>
  );
}
