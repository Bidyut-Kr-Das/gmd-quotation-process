"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BookmarkPlus,
  History,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { SessionList, type ChatSessionMeta } from "./SessionList";
import { MemoryView, type ChatMemory } from "./MemoryView";
import { ConfirmDialog } from "./ConfirmDialog";

type View = "chat" | "sessions" | "memory";

function newId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface ChatViewProps {
  sessionId: string;
  initialMessages: UIMessage[];
  onNewChat: () => void;
  onClear: () => void;
}

function ChatView({
  sessionId,
  initialMessages,
  onNewChat,
  onClear,
}: ChatViewProps) {
  const {
    messages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
    clearError,
  } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    throttle: 60,
  });

  const streaming = status === "submitted" || status === "streaming";
  const [confirmClear, setConfirmClear] = useState(false);

  const copy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage]
  );

  return (
    <>
      <div className="flex h-auto shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2 items-center justify-center">
            <span
              className={cn(
                "absolute inline-flex size-2 animate-ping rounded-sm",
                streaming ? "bg-[#0f62fe]/40 dark:bg-primary/40" : "bg-border"
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2 rounded-sm",
                status === "error"
                  ? "bg-destructive"
                  : streaming
                    ? "bg-[#0f62fe] dark:bg-primary/85"
                    : "bg-muted-foreground/60"
              )}
            />
          </span>
          <div className="flex flex-col">
            <p className="text-[10px] font-semibold uppercase leading-3 tracking-wider text-muted-foreground">
              GMD Assistant
            </p>
            <p className="text-sm font-semibold leading-4 text-foreground">
              Quotation Console
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Clear chat"
            onClick={() => setConfirmClear(true)}
            disabled={streaming || messages.length === 0}
          >
            <Trash2 className="size-5" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear current chat?"
        description="This deletes the current conversation permanently."
        confirmLabel="Clear"
        onConfirm={onClear}
      />

      <ChatMessageList
        messages={messages}
        streaming={streaming}
        error={error}
        onDismissError={clearError}
        onCopy={copy}
        onRetry={regenerate}
        onPickSuggestion={handleSend}
      />

      <ChatInput streaming={streaming} onSend={handleSend} onStop={stop} />
    </>
  );
}

export function ChatPanel({ enabled = true }: { enabled?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [memories, setMemories] = useState<ChatMemory[]>([]);
  const hasOpenedRef = useRef(false);

  const refreshSessions = () => {
    fetch("/api/chat?list=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  };

  const refreshMemories = () => {
    fetch("/api/chat?memories=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setMemories(d.memories ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    refreshSessions();
    if (!hasOpenedRef.current) {
      hasOpenedRef.current = true;
      setInitialMessages([]);
      setSessionId(newId());
      setReady(true);
      return;
    }
    setReady(false);
    const query = sessionId
      ? `?id=${encodeURIComponent(sessionId)}`
      : "";
    fetch(`/api/chat${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setInitialMessages((data.messages as UIMessage[]) ?? []);
        if (!sessionId) setSessionId((data.id as string) ?? newId());
      })
      .catch(() => {
        if (!sessionId) setSessionId(newId());
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (view === "sessions") refreshSessions();
    if (view === "memory") refreshMemories();
  }, [open, view]);

  const resetToNewChat = () => {
    setInitialMessages([]);
    setSessionId(newId());
    setReady(true);
    setView("chat");
  };

  const clearChat = () => {
    if (sessionId) {
      fetch(`/api/chat?id=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    resetToNewChat();
  };

  const openSession = (id: string) => {
    setReady(false);
    fetch(`/api/chat?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setInitialMessages((data.messages as UIMessage[]) ?? []);
        setSessionId(id);
        setView("chat");
      })
      .catch(() => {
        toast.error("Could not open conversation");
      })
      .finally(() => setReady(true));
  };

  const deleteSession = (id: string) => {
    fetch(`/api/chat?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        if (id === sessionId) resetToNewChat();
        else refreshSessions();
      })
      .catch(() => {
        toast.error("Could not delete conversation");
      });
  };

  const deleteMemory = (id: string) => {
    fetch(`/api/chat?memory=1&id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => refreshMemories())
      .catch(() => {
        toast.error("Could not delete memory");
      });
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 p-0 shadow-[0_32px_64px_-24px_rgba(0,0,0,0.25)] sm:max-w-[40vw]!"
          showCloseButton={false}
        >
          {view === "sessions" ? (
            <SessionList
              sessions={sessions}
              activeId={sessionId}
              onOpen={openSession}
              onDelete={deleteSession}
              onBack={() => setView("chat")}
            />
          ) : view === "memory" ? (
            <MemoryView
              memories={memories}
              onDelete={deleteMemory}
              onBack={() => setView("chat")}
            />
          ) : (
            sessionId &&
            ready && (
              <ChatView
                key={sessionId}
                sessionId={sessionId}
                initialMessages={initialMessages}
                onNewChat={resetToNewChat}
                onClear={clearChat}
              />
            )
          )}
        <div
        className="absolute top-24 -left-14 z-10 hidden flex-col gap-2 sm:flex"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="New chat"
          onClick={() => {
            resetToNewChat();
            setOpen(true);
          }}
          className="size-10 rounded-lg border border-border bg-card text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#0f62fe]/60 dark:hover:border-primary/60 hover:text-[#0f62fe] dark:hover:text-primary"
        >
          <Plus className="size-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Recent history"
          onClick={() => {
            setView("sessions");
            setOpen(true);
          }}
          className="size-10 rounded-lg border border-border bg-card text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#0f62fe]/60 dark:hover:border-primary/60 hover:text-[#0f62fe] dark:hover:text-primary"
        >
          <History className="size-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New memory"
          onClick={() => {
            setView("memory");
            setOpen(true);
          }}
          className="size-10 rounded-lg border border-border bg-card text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#0f62fe]/60 dark:hover:border-primary/60 hover:text-[#0f62fe] dark:hover:text-primary"
        >
          <BookmarkPlus className="size-4.5" />
        </Button>
      </div>
    </SheetContent>
      </Sheet>
      {enabled && pathname === "/contract_review" && (
        <Button
          size="icon"
          aria-label="Open AI assistant"
          onClick={() => {
            setView("chat");
            setOpen(true);
          }}
          className="fixed bottom-6 right-6 z-40 size-14 rounded-full bg-[#0a2540] text-white dark:bg-accent dark:text-foreground dark:hover:text-primary-foreground shadow-[0_8px_32px_rgba(10,37,64,0.35)] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#0f62fe] dark:hover:bg-primary hover:shadow-[0_8px_32px_rgba(15,98,254,0.4)] active:scale-95"
        >
          <Sparkles className="size-6" />
        </Button>
      )}
    </>
  );
}