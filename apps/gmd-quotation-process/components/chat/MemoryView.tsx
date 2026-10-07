"use client";

import { formatDistanceToNow } from "date-fns";
import { ChevronLeft, BookmarkPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ChatMemory {
  id: string;
  memory: string;
  createdAt: string;
}

interface MemoryViewProps {
  memories: ChatMemory[];
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function MemoryView({
  memories,
  onDelete,
  onBack,
}: MemoryViewProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-auto shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Back to chat"
            onClick={onBack}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div className="flex flex-col">
            <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.05em] text-muted-foreground">
              Memory
            </p>
            <p className="text-sm font-semibold leading-4 text-foreground">
              Saved facts
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {memories.length}
        </span>
      </div>

      {memories.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="rounded-xl border border-border bg-muted/60 p-1.5">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              <BookmarkPlus className="size-4.5 stroke-[1.5]" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              No memories yet
            </p>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Facts you save here persist across conversations and help the
              assistant remember your preferences.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
          {memories.map((m, i) => (
            <div
              key={`${m.id}-${i}`}
              className="group/memory relative flex items-start justify-between gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-muted/60 active:scale-[0.99] animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <div className="min-w-0 flex-1 pl-2">
                <p className="text-[13px] leading-5 text-foreground">
                  {m.memory}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(m.createdAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete memory"
                className="shrink-0 opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/memory:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(m.id);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        title="Delete memory?"
        description="This permanently removes this saved fact."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteId) onDelete(confirmDeleteId);
        }}
      />
    </div>
  );
}