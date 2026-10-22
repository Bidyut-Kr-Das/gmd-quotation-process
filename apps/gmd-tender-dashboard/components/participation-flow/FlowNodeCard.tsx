"use client";

import type { PositionedNode } from "./layout";

interface FlowNodeCardProps {
  positioned: PositionedNode;
  mode: "rail" | "flow";
  count: number;
  /** Share of the parent's count, or null for a branch root. */
  share: number | null;
  active: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}

/**
 * A single clickable funnel node. Keeps the project's established dark-surface
 * tokens: active is bg-brand/20 + border-brand-accent/50, the same pair used by
 * FilterSidebar person chips and the dark ParticipationCards variant.
 */
export function FlowNodeCard({
  positioned,
  mode,
  count,
  share,
  active,
  onSelect,
  onHover,
}: FlowNodeCardProps) {
  const { node, x, y, width, height } = positioned;
  const isEmpty = count === 0;

  const surface = active
    ? "bg-brand/20 border-brand-accent/50"
    : "bg-white/10 border-white/10 hover:bg-white/20 hover:border-white/20";

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      aria-pressed={active}
      title={`${node.label} — ${count.toLocaleString()}`}
      style={{ left: x, top: y, width, height }}
      className={[
        "absolute flex rounded-lg border text-left transition-colors duration-150",
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-brand-accent focus-visible:ring-offset-0",
        surface,
        isEmpty && !active ? "opacity-55" : "",
        mode === "rail"
          ? "items-center justify-between gap-2 px-2.5 py-1.5"
          : "flex-col justify-center px-3 py-2",
      ].join(" ")}
    >
      {mode === "rail" ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight text-white/75">
            {node.label}
          </span>
          <span className="flex shrink-0 items-baseline gap-1.5">
            {share !== null && (
              <span className="text-[9px] font-medium tabular-nums text-white/35">
                {share}%
              </span>
            )}
            <span
              className={`text-sm font-bold tabular-nums leading-none ${node.accent}`}
            >
              {count}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="truncate text-[9.5px] font-semibold uppercase leading-tight tracking-wider text-white/55">
            {node.label}
          </span>
          <span className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-lg font-bold tabular-nums leading-none ${node.accent}`}
            >
              {count}
            </span>
            {share !== null && (
              <span className="text-[9px] font-medium tabular-nums text-white/35">
                {share}%
              </span>
            )}
          </span>
        </>
      )}
    </button>
  );
}
