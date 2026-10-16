"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

const noop = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // false on server + first client render, true after hydration
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const isDark = mounted && resolvedTheme === "dark";

  const icon =
    "absolute h-[18px] w-[18px] stroke-[1.5] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground ring-1 ring-border transition-[transform,color,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-muted hover:text-foreground active:scale-95"
    >
      <Sun className={`${icon} ${isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"}`} />
      <Moon className={`${icon} ${isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"}`} />
    </button>
  );
}
