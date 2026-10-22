"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyableCommand({
  command,
}: {
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable (insecure origin or denied permission).
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy: ${command}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="truncate">{command}</span>
      {copied ? (
        <Check size={11} className="shrink-0 text-emerald-500" />
      ) : (
        <Copy size={11} className="shrink-0" />
      )}
    </button>
  );
}