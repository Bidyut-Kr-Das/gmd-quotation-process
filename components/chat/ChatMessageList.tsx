"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import {
  ArrowDown,
  BadgeCheck,
  Bot,
  Calculator,
  ChevronRight,
  FileCheck,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChatBubble } from "./ChatBubble";

const SUGGESTIONS: { label: string; icon: typeof Search }[] = [
  { label: "Show latest enquiries from this week", icon: Search },
  { label: "What does item FG-1001 cost?", icon: Calculator },
  { label: "List open contract reviews", icon: FileCheck },
  { label: "Check BIS status for a valve item", icon: BadgeCheck },
];

interface ChatMessageListProps {
  messages: UIMessage[];
  streaming: boolean;
  error?: Error;
  onDismissError: () => void;
  onCopy: (content: string) => void;
  onRetry: () => void;
  onPickSuggestion: (prompt: string) => void;
}

const NEAR_BOTTOM_PX = 80;

export function ChatMessageList({
  messages,
  streaming,
  error,
  onDismissError,
  onCopy,
  onRetry,
  onPickSuggestion,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);

  useEffect(() => {
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({
        behavior: streaming ? "auto" : "smooth",
      });
    }
  }, [messages, streaming, nearBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setNearBottom(
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    );
  };

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 text-center">
        <div className="rounded-xl border border-border bg-muted/60 p-1.5">
          <div className="flex size-11 items-center justify-center rounded-lg bg-[#0f62fe]/10 dark:bg-primary/10 text-[#0f62fe] dark:text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-none">
            <Bot className="size-5 stroke-[1.5]" />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Start a conversation
          </p>
          <p className="text-base font-semibold text-foreground">
            Ask about quotations, BOM, contracts
          </p>
          <p className="mx-auto max-w-[300px] text-[13px] leading-5 text-muted-foreground">
            Get enquiry details, item costs, contract review status, BIS
            checks, and supply history in plain language.
          </p>
        </div>
        <div className="flex w-full max-w-[320px] flex-col gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => onPickSuggestion(s.label)}
              className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#0f62fe]/60 dark:hover:border-primary/60 active:scale-[0.98] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex items-center gap-2.5">
                <s.icon className="size-4 stroke-[1.5] text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:text-[#0f62fe] dark:group-hover:text-primary" />
                <span className="text-[13px] text-foreground">{s.label}</span>
              </span>
              <ChevronRight className="size-3.5 stroke-[1.5] text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:text-[#0f62fe] dark:group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
      >
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <span>Something went wrong. Try again.</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss error"
              onClick={onDismissError}
            >
              <X />
            </Button>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={`${m.id}-${i}`}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] [contain-intrinsic-size:auto_48px] [content-visibility:auto]"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <ChatBubble
              message={m}
              streaming={streaming && i === messages.length - 1}
              onCopy={onCopy}
              onRetry={onRetry}
            />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {!nearBottom && messages.length > 0 && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Jump to latest"
          onClick={() =>
            bottomRef.current?.scrollIntoView({ behavior: "smooth" })
          }
          className={cn(
            "absolute bottom-4 right-4 rounded-full border-border bg-card shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)]",
            "animate-in fade-in fill-mode-both duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          )}
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}