"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDebounce } from "../lib/useDebounce";

// Keeps a filter keystroke inside this leaf and commits upward after 300ms. Tables import
// it so typing does not re-render the whole table body on every character.
export default function DebouncedSearchInput({
  value,
  onCommit,
  placeholder,
  className,
  type = "text",
}: {
  value: string;
  onCommit: (val: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  const [local, setLocal] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const debounced = useDebounce(local, 300);
  const isTypingRef = useRef(false);

  // Adjust during render rather than in an effect, so an external reset (e.g. "Reset all
  // filters") shows in the box on the same commit instead of one render later.
  if (value !== prevValue) {
    setPrevValue(value);
    setLocal(value);
  }

  // An incoming value means the change came from outside, not from typing here. Without this
  // the still-pending debounced keystroke would be committed back and undo the reset.
  useEffect(() => {
    isTypingRef.current = false;
  }, [value]);

  useEffect(() => {
    if (isTypingRef.current && debounced !== value) onCommit(debounced);
  }, [debounced, value, onCommit]);

  return (
    <input
      type={type}
      placeholder={placeholder}
      value={local}
      onChange={(e) => {
        isTypingRef.current = true;
        setLocal(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      className={
        className ||
        "flex-1 min-w-0 text-[10px] border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-1 py-0.5 outline-none placeholder:text-[#0a2540]/30 dark:placeholder:text-muted-foreground/60"
      }
    />
  );
}
