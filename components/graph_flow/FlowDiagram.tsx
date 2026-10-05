"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowNodeCard } from "./FlowNodeCard";
import { FlowEdges } from "./FlowEdges";
import {
  layoutFlow,
  layoutFlowFill,
  type FlowGeometry,
  type FlowLayout,
} from "./layout";
import type { FlowNode } from "./tree";

interface FlowDiagramProps {
  trees: { tree: FlowNode; heading: string; tone: string }[];
  /** Row count per node id, keyed by FlowNode.id. */
  counts: Record<string, number>;
  /** Optional pre-formatted display values per node id (e.g. summed amounts). */
  values?: Record<string, string>;
  /** Node ids currently selected, root first (the active path). */
  activePath: string[];
  /** Toggle a node on/off; receives the node id. */
  onToggle: (id: string) => void;
}

/** Gap between the first tree and the strip of mini-graphs. */
const STRIP_PAD_Y = 8;
/** Horizontal breathing room either side of the strip. */
const STRIP_PAD_X = 16;
/** Gap between two mini-graphs in the strip. */
const STRIP_GAP = 20;
/** Room reserved for a mini-graph's heading label. */
const STRIP_HEADING_H = 14;
/** The first tree never shrinks below this, so its labels stay legible. */
const FIRST_MIN_HEIGHT = 120;
/**
 * Narrower boxes for the mini-graphs than the first tree gets: eight trees side
 * by side have to share the panel width, and the fit-to-box scale below turns
 * the width they save into larger on-screen text.
 */
const STRIP_GEOMETRY: FlowGeometry = {
  nodeWidth: 110,
  nodeHeight: 30,
  colGap: 25,
  rowGap: 3,
};

/** Strip height: the tallest mini-graph plus its heading, as they sit in a row. */
function stripHeightOf(layouts: FlowLayout[]): number {
  if (layouts.length === 0) return 0;
  return Math.max(...layouts.map((l) => l.height)) + STRIP_HEADING_H;
}

/** Natural (unscaled) width of the side-by-side mini-graphs. */
function stripWidthOf(layouts: FlowLayout[]): number {
  if (layouts.length === 0) return 0;
  return (
    layouts.reduce((s, l) => s + l.width, 0) +
    STRIP_GAP * (layouts.length - 1)
  );
}

export function FlowDiagram({
  trees,
  counts,
  values,
  activePath,
  onToggle,
}: FlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(400);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleHover = useCallback((id: string | null) => {
    setHoveredId(id);
  }, []);

  const activeIds = useMemo(
    () => new Set<string>(activePath),
    [activePath],
  );

  const layouts = useMemo(() => {
    if (trees.length === 0) return [];
    const W = containerWidth > 0 ? containerWidth : 600;
    const H = containerHeight > 0 ? containerHeight : 400;
    // Trees after the first render side by side in one strip, so it costs the
    // tallest tree's height rather than the sum of all of them.
    const restLayouts = trees
      .slice(1)
      .map(({ tree }) => layoutFlow(tree, STRIP_GEOMETRY));
    const stripHeight = stripHeightOf(restLayouts);
    // First tree (Live) fills the full width + remaining height.
    const first = layoutFlowFill(
      trees[0].tree,
      W,
      Math.max(FIRST_MIN_HEIGHT, H - stripHeight - STRIP_PAD_Y),
    );
    return [first, ...restLayouts];
  }, [trees, containerWidth, containerHeight]);

  /**
   * Fit-to-box scale for the strip: one uniform factor for the whole row so
   * every mini-graph stays visible without horizontal scrolling, clamped by
   * height too so the strip can never squeeze the first tree below its floor.
   */
  const stripScale = useMemo(() => {
    const rest = layouts.slice(1);
    if (rest.length === 0) return 1;
    const availW = Math.max(240, containerWidth - STRIP_PAD_X * 2);
    const availH = Math.max(
      60,
      containerHeight - FIRST_MIN_HEIGHT - STRIP_PAD_Y * 2,
    );
    return Math.min(
      1,
      availW / stripWidthOf(rest),
      availH / stripHeightOf(rest),
    );
  }, [layouts, containerWidth, containerHeight]);

  const emptyIds = useMemo(
    () =>
      new Set<string>(
        Object.entries(counts)
          .filter(([, count]) => count === 0)
          .map(([id]) => id),
      ),
    [counts],
  );

  const edgeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const layout of layouts) {
      for (const positioned of layout.nodes) {
        colors[positioned.node.id] = positioned.node.edge;
      }
    }
    return colors;
  }, [layouts]);

  const renderTreeNodes = (layout: FlowLayout, tree: FlowNode) => (
    <>
      <FlowEdges
        layout={layout}
        edgeColors={edgeColors}
        activeIds={activeIds}
        emptyIds={emptyIds}
        hoveredId={hoveredId}
      />
      {layout.nodes.map((positioned) => {
        const node = positioned.node;
        const parentId = tree.id === node.id ? null : parentOf(tree, node.id);
        const parentCount =
          parentId === null ? null : counts[parentId] ?? 0;
        const count = counts[node.id] ?? 0;
        const share =
          parentId === null || !parentCount
            ? null
            : Math.round((count / parentCount) * 100);
        return (
          <FlowNodeCard
            key={node.id}
            positioned={positioned}
            mode={layout.mode}
            count={count}
            share={share}
            displayValue={values?.[node.id]}
            active={activeIds.has(node.id)}
            onSelect={() => onToggle(node.id)}
            onHover={handleHover}
          />
        );
      })}
    </>
  );

if (trees.length === 0) return null;

  const rest = layouts.slice(1);
  const stripWidth = stripWidthOf(rest);
  const stripHeight = stripHeightOf(rest);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-hidden flex flex-col"
    >
      {layouts[0] && (
        <div
          className="relative shrink-0 mt-1"
          style={{ width: layouts[0].width, height: layouts[0].height }}
        >
          {renderTreeNodes(layouts[0], trees[0].tree)}
        </div>
      )}
      {rest.length > 0 && (
        <div
          className="relative shrink-0 mt-1"
          style={{
            width: stripWidth * stripScale + STRIP_PAD_X * 2,
            height: stripHeight * stripScale,
          }}
        >
          <div
            className="absolute top-0 origin-top-left"
            style={{
              left: STRIP_PAD_X,
              width: stripWidth,
              height: stripHeight,
              transform: `scale(${stripScale})`,
            }}
          >
            <div className="flex items-start" style={{ gap: STRIP_GAP }}>
              {rest.map((layout, index) => {
                const { tree, heading, tone } = trees[index + 1];
                return (
                  <div
                    key={tree.id}
                    className="flex shrink-0 flex-col"
                    style={{ width: layout.width }}
                  >
                    <span
                      className={`truncate text-[10px] font-bold uppercase tracking-wider ${tone}`}
                      style={{
                        height: STRIP_HEADING_H,
                        lineHeight: `${STRIP_HEADING_H}px`,
                      }}
                    >
                      {heading}
                    </span>
                    <div
                      style={{ width: layout.width, height: layout.height }}
                      className="relative"
                    >
                      {renderTreeNodes(layout, tree)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parentOf(root: FlowNode, id: string): string | null {
  const walk = (node: FlowNode, parent: string | null): string | null => {
    if (node.id === id) return parent;
    for (const kid of node.children ?? []) {
      const found = walk(kid, node.id);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, null);
}