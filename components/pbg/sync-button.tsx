"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncPbgDataAction } from "@/app/pbg/actions";

type Status = { tone: "success" | "error"; text: string } | null;

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  function handleClick() {
    setStatus(null);
    startTransition(async () => {
      const result = await syncPbgDataAction();
      if (result.ok) {
        const seconds = (result.durationMs / 1000).toFixed(1);
        setStatus({
          tone: "success",
          text: `Inserted ${result.inserted} · Updated ${result.updated} · Unchanged ${result.unchanged} in ${seconds}s`,
        });
        router.refresh();
      } else {
        setStatus({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? <Spinner /> : <RefreshIcon />}
        {isPending ? "Syncing…" : "Sync from Sheet"}
      </button>
      {status && (
        <p
          className={
            status.tone === "success"
              ? "max-w-xs text-xs font-medium text-emerald-600"
              : "max-w-xs text-xs font-medium text-rose-600"
          }
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
