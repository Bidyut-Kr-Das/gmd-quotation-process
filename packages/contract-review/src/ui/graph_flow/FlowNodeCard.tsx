"use client";

import type { PositionedNode } from "./layout";

interface FlowNodeCardProps {
  positioned: PositionedNode;
  mode: "rail" | "flow";
  count: number;
  /** Share of the parent's count, or null for a branch root. */
  share: number | null;
  /** Optional pre-formatted value shown instead of the raw count. */
  displayValue?: string;
  active: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}

/**
 * A single clickable funnel node. Keeps the project's established dark-surface
 * tokens: active is bg-blue-500/20 + border-blue-400/50, the same pair used by
 * FilterSidebar person chips and the dark ParticipationCards variant.
 */
export function FlowNodeCard({
  positioned,
  mode,
  count,
  share,
  displayValue,
  active,
  onSelect,
  onHover,
}: FlowNodeCardProps) {
  const { node, x, y, width, height } = positioned;
  const isEmpty = count === 0;
  const bigNumber = displayValue !== undefined ? displayValue : count;
  const secondary =
    displayValue !== undefined
      ? count.toLocaleString()
      : share !== null
        ? `${share}%`
        : null;

  const surface = active
    ? "bg-blue-500/20 border-blue-400/50"
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
      title={`${node.label} — ${displayValue !== undefined ? `${displayValue} (${count.toLocaleString()} rows)` : count.toLocaleString()}`}
      style={{ left: x, top: y, width, height }}
      className={[
        "absolute flex rounded-lg border text-left transition-colors duration-150",
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-blue-400 focus-visible:ring-offset-0",
        surface,
        isEmpty && !active ? "opacity-55" : "",
        mode === "rail"
          ? "items-center justify-between gap-2 px-2.5 py-1.5"
          : "items-center justify-between gap-2 px-2 py-1",
      ].join(" ")}
    >
      {mode === "rail" ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight text-white/75">
            {node.label}
          </span>
          <span className="flex shrink-0 items-baseline gap-1.5">
            {secondary !== null && (
              <span className="text-[9px] font-medium tabular-nums text-white/35">
                {secondary}
              </span>
            )}
            <span
              className={`text-sm font-bold tabular-nums leading-none ${node.accent}`}
            >
              {bigNumber}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[9.5px] font-semibold uppercase leading-tight tracking-wider text-white/55">
            {node.label}
          </span>
          <span className="flex shrink-0 items-baseline gap-1.5">
            {secondary !== null && (
              <span className="text-[9px] font-medium tabular-nums text-white/35">
                {secondary}
              </span>
            )}
            <span
              className={`text-sm font-bold tabular-nums leading-none ${node.accent}`}
            >
              {bigNumber}
            </span>
          </span>
        </>
      )}
    </button>
  );
}
