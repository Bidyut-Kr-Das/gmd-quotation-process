"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  History,
  MessageSquareText,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@gmd/ui/components/button";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ChatSessionMeta {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface SessionListProps {
  sessions: ChatSessionMeta[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function SessionList({
  sessions,
  activeId,
  onOpen,
  onDelete,
  onBack,
}: SessionListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pendingSession = sessions.find((s) => s.id === confirmDeleteId);

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
              Conversations
            </p>
            <p className="text-sm font-semibold leading-4 text-foreground">
              Chat history
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {sessions.length}
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="rounded-xl border border-border bg-muted/60 p-1.5">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-none">
              <History className="size-4.5 stroke-[1.5]" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              No previous conversations
            </p>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Your chat history will appear here after your first message.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
          {sessions.map((s, i) => {
            const active = s.id === activeId;
            return (
              <div
                key={s.id}
                className={cn(
                  "group/session relative flex cursor-pointer items-center justify-between gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-muted/60 active:scale-[0.99]",
                  active && "bg-muted/40",
                  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                )}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                onClick={() => onOpen(s.id)}
              >
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-0.5 bg-[#0f62fe] dark:bg-primary/85 transition-opacity duration-200",
                    active ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex min-w-0 flex-1 items-start gap-2.5 pl-2">
                  <MessageSquareText className="mt-0.5 size-3.5 shrink-0 stroke-[1.5] text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/session:text-[#0f62fe]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(s.updatedAt), {
                        addSuffix: true,
                      })}
                      {" · "}
                      {s.messageCount} messages
                      {active && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#0f62fe] dark:text-primary">
                          Active
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete conversation"
                  className="shrink-0 opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/session:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(s.id);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        title="Delete conversation?"
        description={
          pendingSession
            ? `This permanently removes "${pendingSession.title}" and its messages.`
            : "This permanently removes the conversation and its messages."
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteId) onDelete(confirmDeleteId);
        }}
      />
    </div>
  );
}