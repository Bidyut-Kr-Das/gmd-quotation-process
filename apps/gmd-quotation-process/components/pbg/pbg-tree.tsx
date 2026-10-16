"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  buildPbgTree,
  collectExpandableKeys,
  isSelectionPrefix,
  isSelectionSelected,
  toPbgFlowRoot,
  type PbgStatusCounts,
  type PbgTreeNode,
  type PbgTreeSelection,
} from "@/lib/pbg/pbg-tree";
import {
  layoutPbgFlow,
  type PbgFlowLevel,
  type PbgFlowNode,
  type PbgPositionedNode,
} from "@/lib/pbg/pbg-tree-layout";
import type { PbgRecord } from "@/lib/pbg/pbg-data";
import { formatAmount, formatDate } from "@/lib/pbg/format";

type PbgTreeProps = {
  records: PbgRecord[];
  selections: PbgTreeSelection[];
  onToggleSelection: (selection: PbgTreeSelection) => void;
  includeClosed: boolean;
  onToggleClosed: () => void;
  pending: boolean;
  onClear: () => void;
};

const LEVEL_ACCENT: Record<PbgFlowLevel, string> = {
  root: "border-l-slate-800",
  client: "border-l-indigo-500",
  project: "border-l-sky-500",
  bg: "border-l-emerald-500",
  po: "border-l-slate-400",
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const DRAG_THRESHOLD = 4;
const PAD = 16;

/**
 * Finds the deepest tree node matching an active selection, along with the keys
 * of its ancestors so they can be expanded to bring the node into the layout.
 */
function findActiveNode(
  forest: PbgTreeNode[],
  selections: PbgTreeSelection[],
): { key: string; ancestorKeys: string[] } | null {
  if (selections.length === 0) return null;
  let best: { key: string; ancestorKeys: string[] } | null = null;

  const walk = (nodes: PbgTreeNode[], ancestors: string[]) => {
    for (const node of nodes) {
      if (
        isSelectionSelected(selections, node.selection) &&
        (!best || ancestors.length >= best.ancestorKeys.length)
      ) {
        best = { key: node.key, ancestorKeys: ancestors };
      }
      walk(node.children, [...ancestors, node.key]);
    }
  };

  walk(forest, []);
  return best;
}

type View = { x: number; y: number; scale: number };

type PanSession = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type PinchSession = {
  dist: number;
  scale: number;
  cx: number;
  cy: number;
  originX: number;
  originY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

function StatusDots({ statuses }: { statuses: PbgStatusCounts }) {
  const items = [
    { key: "running", label: "Running", count: statuses.running, cls: "bg-emerald-500" },
    { key: "expired", label: "Expired", count: statuses.expired, cls: "bg-rose-500" },
    { key: "closed", label: "Closed", count: statuses.closed, cls: "bg-slate-400" },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      {items.map((item) => (
        <span
          key={item.key}
          title={`${item.label}: ${item.count}`}
          className="inline-flex items-center gap-1 text-[9px] font-medium leading-none text-slate-500"
        >
          {item.count}
          <span className={`h-1.5 w-1.5 rounded-full ${item.cls}`} />
        </span>
      ))}
    </span>
  );
}

function subtitleFor(node: PbgFlowNode): string | null {
  if (node.level === "bg") {
    const parts: string[] = [];
    if (node.date) parts.push(formatDate(node.date));
    if (node.amount !== null) parts.push(formatAmount(node.amount));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (node.level === "po") {
    return node.date ? formatDate(node.date) : null;
  }
  if (node.level === "root") {
    return `${node.count} client${node.count === 1 ? "" : "s"}`;
  }
  return null;
}

function PbgFlowCard({
  positioned,
  selections,
  onToggleSelection,
  onToggleExpand,
}: {
  positioned: PbgPositionedNode;
  selections: PbgTreeSelection[];
  onToggleSelection: (selection: PbgTreeSelection) => void;
  onToggleExpand: (key: string) => void;
}) {
  const { node, x, y, width, height } = positioned;
  const active =
    isSelectionSelected(selections, node.selection) ||
    (node.level === "root" && selections.length === 0);
  const isRoot = node.level === "root";
  const subtitle = subtitleFor(node);

  function activate() {
    onToggleSelection(node.selection);
    if (node.hasChildren) onToggleExpand(node.key);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      className={[
        "absolute left-0 top-0 flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border border-l-2 bg-white px-2 shadow-sm outline-none",
        "animate-in fade-in duration-200",
        "transition-[box-shadow,background-color,border-color] duration-200 ease-out",
        LEVEL_ACCENT[node.level],
        active
          ? "border-indigo-300 bg-indigo-50 shadow-md ring-1 ring-inset ring-indigo-300"
          : "hover:border-slate-300 hover:shadow-md",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[11px] text-slate-800 ${
            isRoot ? "font-bold" : "font-semibold"
          }`}
        >
          {node.label}
        </div>
        {subtitle && (
          <div className="truncate text-[9px] font-medium tabular-nums text-slate-500">
            {subtitle}
          </div>
        )}
      </div>

      {node.level === "bg" && node.statuses && (
        <StatusDots statuses={node.statuses} />
      )}

      {node.level !== "po" && (
        <span
          className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
            active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {node.count}
        </span>
      )}
    </div>
  );
}

export function PbgTree({
  records,
  selections,
  onToggleSelection,
  includeClosed,
  onToggleClosed,
  pending,
  onClear,
}: PbgTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>({ x: PAD, y: PAD, scale: 1 });
  const [panning, setPanning] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panRef = useRef<PanSession | null>(null);
  const pinchRef = useRef<PinchSession | null>(null);
  const movedRef = useRef(false);

  const clients = useMemo(() => buildPbgTree(records), [records]);
  const flowRoot = useMemo(
    () => toPbgFlowRoot(clients, expanded),
    [clients, expanded],
  );
  const layout = useMemo(() => layoutPbgFlow(flowRoot), [flowRoot]);

  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selections.length === 0) return keys;
    for (const positioned of layout.nodes) {
      if (selections.some((s) => isSelectionPrefix(positioned.node.selection, s))) {
        keys.add(positioned.node.key);
      }
    }
    return keys;
  }, [layout.nodes, selections]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(collectExpandableKeys(clients)));
  }, [clients]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const resetView = useCallback(() => {
    const active = findActiveNode(clients, selections);
    if (!active) {
      setView({ x: PAD, y: PAD, scale: 1 });
      return;
    }

    // Expand the path to the active node, then lay it out directly so we can
    // centre it without waiting for a re-render.
    const nextExpanded = new Set(expanded);
    for (const key of active.ancestorKeys) nextExpanded.add(key);
    setExpanded(nextExpanded);

    const nextLayout = layoutPbgFlow(toPbgFlowRoot(clients, nextExpanded));
    const positioned = nextLayout.nodes.find((p) => p.node.key === active.key);
    const el = viewportRef.current;
    if (!positioned || !el) return;

    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (!vw || !vh) {
      setView({ x: PAD, y: PAD, scale: 1 });
      return;
    }

    setView((prev) => ({
      scale: prev.scale,
      x: vw / 2 - (positioned.x + positioned.width / 2) * prev.scale,
      y: vh / 2 - (positioned.y + positioned.height / 2) * prev.scale,
    }));
  }, [clients, selections, expanded]);

  const onWindowMove = useCallback((event: PointerEvent) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const pinch = pinchRef.current;
      const nextScale = clamp(
        pinch.scale * (dist / pinch.dist),
        MIN_SCALE,
        MAX_SCALE,
      );
      const worldX = (pinch.cx - pinch.originX) / pinch.scale;
      const worldY = (pinch.cy - pinch.originY) / pinch.scale;
      setView({
        scale: nextScale,
        x: pinch.cx - worldX * nextScale,
        y: pinch.cy - worldY * nextScale,
      });
      movedRef.current = true;
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) pan.moved = true;
    if (pan.moved) {
      movedRef.current = true;
      setView((prev) => ({
        ...prev,
        x: pan.originX + dx,
        y: pan.originY + dy,
      }));
    }
  }, []);

  const onWindowUp = useCallback((event: PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      panRef.current = null;
      setPanning(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    return () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    };
  }, [onWindowMove, onWindowUp]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((prev) => {
        const nextScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
        if (nextScale === prev.scale) return prev;
        const worldX = (mx - prev.x) / prev.scale;
        const worldY = (my - prev.y) / prev.scale;
        return {
          scale: nextScale,
          x: mx - worldX * nextScale,
          y: my - worldY * nextScale,
        };
      });
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    if (!el) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const current = viewRef.current;

    if (pointersRef.current.size === 1) {
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
        moved: false,
      };
      movedRef.current = false;
      setPanning(true);
    } else if (pointersRef.current.size === 2) {
      const rect = el.getBoundingClientRect();
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: current.scale,
        cx: (a.x + b.x) / 2 - rect.left,
        cy: (a.y + b.y) / 2 - rect.top,
        originX: current.x,
        originY: current.y,
      };
      panRef.current = null;
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (movedRef.current) {
      event.stopPropagation();
      event.preventDefault();
      movedRef.current = false;
    }
  }

  const clearing = selections.length > 0;

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-slate-50/40">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Navigator
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!includeClosed}
          onClick={onToggleClosed}
          disabled={pending}
          title="Exclude records with status Closed"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 disabled:opacity-60"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
              includeClosed ? "bg-slate-300" : "bg-emerald-500"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                includeClosed ? "translate-x-0.5" : "translate-x-3.5"
              }`}
            />
          </span>
          {pending ? <Spinner /> : "Exclude Closed"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        <button
          type="button"
          onClick={expandAll}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={resetView}
          title="Reset the view, or centre the selected node"
          className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70"
        >
          Reset view
        </button>
        <span className="ml-auto pr-1 text-[10px] font-medium tabular-nums text-slate-400">
          {Math.round(view.scale * 100)}%
        </span>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${
          panning ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {clients.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            No records to show.
          </p>
        ) : (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const activeEdge = activeKeys.has(edge.childKey);
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={activeEdge ? "rgb(99 102 241)" : "rgb(203 213 225)"}
                    strokeWidth={activeEdge ? 2 : 1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transition:
                        "d 200ms ease-out, stroke 150ms ease, stroke-width 150ms ease",
                    }}
                  />
                );
              })}
            </svg>

            {layout.nodes.map((positioned) => (
              <PbgFlowCard
                key={positioned.node.key}
                positioned={positioned}
                selections={selections}
                onToggleSelection={onToggleSelection}
                onToggleExpand={toggleExpand}
              />
            ))}
          </div>
        )}
      </div>

      {clearing && (
        <div className="border-t border-slate-200 p-2">
          <button
            type="button"
            onClick={onClear}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear selection ({selections.length})
          </button>
        </div>
      )}
    </aside>
  );
}
