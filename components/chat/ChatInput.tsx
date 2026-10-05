"use client";

import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatInput({ streaming, onSend, onStop }: ChatInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  return (
    <form
      className="border-t border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-lg border border-border bg-muted/60 p-1.5 transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about quotations, BOM, contracts…"
          className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {streaming ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={onStop}
            aria-label="Stop generating"
            className="transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!value.trim()}
            className="bg-[#0f62fe] dark:bg-primary/85 text-white dark:text-primary-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#0353e9] dark:hover:bg-primary active:scale-95 disabled:bg-muted disabled:text-muted-foreground"
          >
            <ArrowUp className="stroke-[2]" />
          </Button>
        )}
      </div>
    </form>
  );
}