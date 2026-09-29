import { type ReactNode } from "react";
import { RefreshCw, Loader2 } from "lucide-react";

interface GMDUpdateHeaderProps {
  totalRows: number;
  syncedAt?: string | null;
  onSync?: () => void;
  syncing?: boolean;
  title?: string;
  actions?: ReactNode;
}

function formatSyncTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "Unknown";
  }
}

export default function GMDUpdateHeader({
  totalRows,
  syncedAt = null,
  onSync,
  syncing,
  title = "GMD UPDATE",
  actions,
}: GMDUpdateHeaderProps) {
  return (
    <div className="bg-[#0a2540] px-6 py-3 border-b border-[#1e3d59] flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white">{title}</h2>
        <span className="bg-[#1e3d59] text-[#38ef7d] text-[11px] font-semibold px-3 py-1 rounded-full">
          {totalRows} items
        </span>
        {syncedAt !== undefined && (
          <span className="text-[11px] text-white/50 font-medium">
            Last synced: {formatSyncTime(syncedAt)}
          </span>
        )}
      </div>
    {(onSync || actions) && (
        <div className="flex items-center gap-2">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {syncing ? "Syncing..." : "Sync"}
            </button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}