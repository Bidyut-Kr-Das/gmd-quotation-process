"use client";

import type { FlowLayout } from "./layout";

interface FlowEdgesProps {
  layout: FlowLayout;
  /** Edge colour per child id, used when that edge is on a live path. */
  edgeColors: Record<string, string>;
  /** Child ids whose incoming edge should read as active. */
  activeIds: Set<string>;
  /** Child ids whose node has a zero count, so the edge is dimmed. */
  emptyIds: Set<string>;
  /** Child id currently hovered, for a subtle lift on that one edge. */
  hoveredId: string | null;
}

/**
 * The whole connector layer, drawn as one SVG in the same coordinate space the
 * layout produced. Because node positions and path endpoints come from the same
 * numbers, connectors terminate exactly on node edges - no measurement, and no
 * preserveAspectRatio scaling to distort the stroke.
 */
export function FlowEdges({
  layout,
  edgeColors,
  activeIds,
  emptyIds,
  hoveredId,
}: FlowEdgesProps) {
  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      aria-hidden="true"
    >
      {layout.edges.map((edge) => {
        const isActive = activeIds.has(edge.childId);
        const isHovered = hoveredId === edge.childId;
        const isEmpty = emptyIds.has(edge.childId);

        let stroke = "rgba(255,255,255,0.24)";
        let strokeWidth = 1.25;

        if (isEmpty && !isActive) {
          stroke = "rgba(255,255,255,0.10)";
          strokeWidth = 1;
        }
        if (isHovered) {
          stroke = "rgba(255,255,255,0.55)";
          strokeWidth = 1.5;
        }
        if (isActive) {
          stroke = edgeColors[edge.childId] ?? "rgba(255,255,255,0.7)";
          strokeWidth = 1.75;
        }

        return (
          <path
            key={edge.id}
            d={edge.path}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-[stroke,stroke-width] duration-150"
          />
        );
      })}
    </svg>
  );
}
