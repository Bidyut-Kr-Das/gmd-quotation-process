"use client";

import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared loading / error / empty states, styled to the quotation app's
 * neutral chassis: muted icon, foreground title, muted description.
 */

export function DataLoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
    >
      <Loader2 className="size-6 animate-spin" />
      <span className="text-sm font-medium">{label}</span>
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
    <div role="alert" className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <AlertCircle size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {message && <p className="max-w-md text-sm text-pretty text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function DataEmptyState({
  label = "No matching records found.",
  description,
  action,
}: {
  label?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Inbox size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description && <p className="max-w-md text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action}
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
      <div className="h-full w-1/3 animate-[dataStateSlide_1.1s_ease-in-out_infinite] rounded-full bg-signal" />
      <style>{`@keyframes dataStateSlide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}
