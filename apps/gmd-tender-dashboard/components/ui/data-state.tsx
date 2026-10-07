"use client";

import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

/**
 * Shared loading / error / empty states.
 *
 * These replace the hand-rolled inline-styled spinner and error blocks that
 * were copy-pasted into each page (including a duplicated @keyframes spin
 * definition per page). The visual language is unchanged - navy text, blue
 * spinner - just centralised.
 */

export function DataLoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex min-h-[500px] flex-1 flex-col items-center justify-center gap-4 text-brand">
      <span className="size-10 animate-spin rounded-full border-4 border-[#e1e6eb] border-t-brand-accent" />
      <span className="text-[15px] font-bold tracking-[0.5px]">{label}</span>
    </div>
  );
}

export function DataErrorState({
  message,
  onRetry,
  label = "Failed to load",
}: {
  message?: string;
  onRetry?: () => void;
  label?: string;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertCircle className="text-[#c5221f]" size={28} />
      <p className="font-semibold text-[#c5221f]">
        {label}
        {message ? `: ${message}` : ""}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-brand px-4 py-2 font-semibold text-white transition-opacity hover:opacity-90"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function DataEmptyState({
  label = "No matching records found.",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-black/40">
      <Inbox size={22} />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/**
 * Thin bar shown while a background revalidation is in flight. Lets a page keep
 * showing cached rows instead of collapsing to a full-page spinner on refresh.
 */
export function RefreshingBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="status"
      aria-label="Refreshing"
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-[dataStateSlide_1.1s_ease-in-out_infinite] rounded-full bg-brand-accent" />
      <style>{`@keyframes dataStateSlide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}
