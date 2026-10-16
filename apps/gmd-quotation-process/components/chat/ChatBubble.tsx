"use client";

import { memo, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  Bookmark,
  Check,
  Copy,
  GitBranch,
  Loader2,
  RotateCcw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@gmd/ui/components/button";
import { Markdown } from "./Markdown";
import { DownloadFileCard } from "./DownloadFileCard";

const TOOL_LABELS: Record<string, string> = {
  lookup_contract_review: "Contract review lookup",
  memorize: "Saving to memory",
  remember: "Recalling memory",
};

const TOOL_ICONS: Record<string, typeof GitBranch> = {
  lookup_contract_review: GitBranch,
  memorize: Bookmark,
  remember: Search,
};

function toolLabel(name: string): string {
  return (
    TOOL_LABELS[name] ??
    name.split("_").join(" ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface ChatBubbleProps {
  message: UIMessage;
  streaming: boolean;
  onCopy: (content: string) => void;
  onRetry: () => void;
}

const TYPING_DOT_DELAYS = [0, 150, 300];

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export const ChatBubble = memo(function ChatBubble({
  message,
  streaming,
  onCopy,
  onRetry,
}: ChatBubbleProps) {
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const isUser = message.role === "user";

  const handleCopy = () => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[#0a2540] px-3 py-2 text-sm text-white dark:bg-primary/15 dark:text-foreground dark:shadow-none shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.99]">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="group/bubble flex flex-col items-start">
      <div
        className={cn(
          "max-w-[85%] min-w-0 rounded-lg border border-border bg-card px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-none transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-ring",
          streaming && "border-[#0f62fe]/50 dark:border-primary/50"
        )}
      >
        {message.parts.filter(isToolUIPart).length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.parts.filter(isToolUIPart).map((part, i) => {
              const name = part.type.startsWith("tool-")
                ? part.type.slice(5)
                : "tool";
              const running =
                part.state === "input-streaming" ||
                part.state === "input-available";
              const failed = part.state === "output-error";
              if (part.state === "output-available") {
                const output = (part as { output?: unknown }).output as
                  | { fileName?: string; downloadUrl?: string }
                  | undefined;
                if (output?.fileName && output?.downloadUrl) {
                  return (
                    <DownloadFileCard
                      key={part.toolCallId}
                      fileName={output.fileName}
                      downloadUrl={output.downloadUrl}
                    />
                  );
                }
              }
              const ToolIcon = TOOL_ICONS[name] ?? Wrench;
              return (
                <span
                  key={`${part.toolCallId}-${i}`}
                  className={cn(
                    "inline-flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium",
                    failed
                      ? "border border-destructive/30 bg-destructive/10 text-destructive"
                      : "border border-[#0f62fe]/40 dark:border-primary/40 bg-card text-foreground"
                  )}
                >
                  {running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : failed ? (
                    <X className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  <ToolIcon className="size-4" />
                  {toolLabel(name)}
                </span>
              );
            })}
          </div>
        )}
        {text && <Markdown>{text}</Markdown>}
        {streaming && !text && (
          <span className="flex items-center gap-1 py-0.5">
            {TYPING_DOT_DELAYS.map((d) => (
              <span
                key={d}
                className="size-1.5 animate-pulse rounded-xs bg-[#0f62fe] dark:bg-primary/85"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/bubble:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? "Copied" : "Copy message"}
          onClick={handleCopy}
          disabled={!text}
        >
          {copied ? <Check className="text-emerald-600 dark:text-emerald-300" /> : <Copy />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Regenerate answer"
          onClick={onRetry}
        >
          <RotateCcw className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:rotate-90" />
        </Button>
      </div>
    </div>
  );
});