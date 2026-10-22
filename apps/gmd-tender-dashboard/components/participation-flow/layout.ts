import type { FlowNode } from "./tree";

export type FlowMode = "rail" | "flow";

export interface PositionedNode {
  node: FlowNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge {
  id: string;
  parentId: string;
  childId: string;
  path: string;
}

export interface FlowLayout {
  mode: FlowMode;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

/** Left-to-right diagram geometry (wide sidebar). */
export const FLOW_NODE_WIDTH = 138;
export const FLOW_NODE_HEIGHT = 56;
export const FLOW_COL_GAP = 32;
export const FLOW_ROW_GAP = 12;

/** Indented-rail geometry (narrow sidebar). */
export const RAIL_NODE_HEIGHT = 38;
export const RAIL_ROW_GAP = 6;
export const RAIL_INDENT = 16;
export const RAIL_STEM = 8;

/** Corner radius for the orthogonal elbows. Clamped per-edge so tight
 *  spacing can never make an arc overshoot its own leg. */
const CORNER = 9;

/** Width below which the rail layout is used instead of the LR diagram. */
export const FLOW_MODE_MIN_WIDTH = 520;

function childrenOf(node: FlowNode): FlowNode[] {
  return node.children ?? [];
}

/**
 * Tidy-tree placement, left-to-right: depth drives the cross axis, leaves are
 * assigned sequential rows and every parent is centred on the span of its
 * children. Purely computed - no DOM measurement - so the edge paths below
 * land exactly on node edges by construction.
 */
export function layoutFlow(root: FlowNode): FlowLayout {
  const nodes: PositionedNode[] = [];
  const byId = new Map<string, PositionedNode>();
  const stride = FLOW_NODE_HEIGHT + FLOW_ROW_GAP;
  let leafCursor = 0;
  let maxDepth = 0;

  const place = (node: FlowNode, depth: number): PositionedNode => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = childrenOf(node);
    let y: number;
    if (kids.length === 0) {
      y = leafCursor * stride;
      leafCursor += 1;
    } else {
      const placed = kids.map((kid) => place(kid, depth + 1));
      y = (placed[0].y + placed[placed.length - 1].y) / 2;
    }
    const positioned: PositionedNode = {
      node,
      depth,
      x: depth * (FLOW_NODE_WIDTH + FLOW_COL_GAP),
      y,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
    };
    nodes.push(positioned);
    byId.set(node.id, positioned);
    return positioned;
  };

  place(root, 0);

  const edges = buildEdges(root, byId, elbowLeftToRight);

  return {
    mode: "flow",
    nodes,
    edges,
    width: (maxDepth + 1) * FLOW_NODE_WIDTH + maxDepth * FLOW_COL_GAP,
    height: Math.max(0, leafCursor * stride - FLOW_ROW_GAP),
  };
}

/**
 * Indented-rail placement: nodes stack in depth-first order and depth becomes
 * left indentation, so every node keeps near-full width and stays readable in
 * a 200-260px sidebar.
 */
export function layoutRail(root: FlowNode, containerWidth: number): FlowLayout {
  const nodes: PositionedNode[] = [];
  const byId = new Map<string, PositionedNode>();
  const stride = RAIL_NODE_HEIGHT + RAIL_ROW_GAP;
  const width = Math.max(160, containerWidth);
  let row = 0;

  const place = (node: FlowNode, depth: number) => {
    const x = depth * RAIL_INDENT;
    const positioned: PositionedNode = {
      node,
      depth,
      x,
      y: row * stride,
      width: Math.max(96, width - x),
      height: RAIL_NODE_HEIGHT,
    };
    row += 1;
    nodes.push(positioned);
    byId.set(node.id, positioned);
    for (const kid of childrenOf(node)) place(kid, depth + 1);
  };

  place(root, 0);

  const edges = buildEdges(root, byId, elbowRail);

  return {
    mode: "rail",
    nodes,
    edges,
    width,
    height: Math.max(0, row * stride - RAIL_ROW_GAP),
  };
}

function buildEdges(
  root: FlowNode,
  byId: Map<string, PositionedNode>,
  shape: (parent: PositionedNode, child: PositionedNode) => string,
): PositionedEdge[] {
  const edges: PositionedEdge[] = [];
  const walk = (node: FlowNode) => {
    const parent = byId.get(node.id);
    if (!parent) return;
    for (const kid of childrenOf(node)) {
      const child = byId.get(kid.id);
      if (child) {
        edges.push({
          id: node.id + "->" + kid.id,
          parentId: node.id,
          childId: kid.id,
          path: shape(parent, child),
        });
      }
      walk(kid);
    }
  };
  walk(root);
  return edges;
}

/** Parent right edge -> child left edge, with a rounded dogleg at the midpoint. */
function elbowLeftToRight(parent: PositionedNode, child: PositionedNode): string {
  const x1 = parent.x + parent.width;
  const y1 = parent.y + parent.height / 2;
  const x2 = child.x;
  const y2 = child.y + child.height / 2;
  const midX = x1 + (x2 - x1) / 2;

  if (Math.abs(y2 - y1) < 0.5) return `M ${r(x1)} ${r(y1)} H ${r(x2)}`;

  const dir = y2 > y1 ? 1 : -1;
  const radius = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX));

  return [
    `M ${r(x1)} ${r(y1)}`,
    `H ${r(midX - radius)}`,
    `Q ${r(midX)} ${r(y1)} ${r(midX)} ${r(y1 + dir * radius)}`,
    `V ${r(y2 - dir * radius)}`,
    `Q ${r(midX)} ${r(y2)} ${r(midX + radius)} ${r(y2)}`,
    `H ${r(x2)}`,
  ].join(" ");
}

/** Vertical rail dropping from the parent, turning into the child's left edge. */
function elbowRail(parent: PositionedNode, child: PositionedNode): string {
  const x = parent.x + RAIL_STEM;
  const y1 = parent.y + parent.height;
  const y2 = child.y + child.height / 2;
  const x2 = child.x;
  const radius = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(x2 - x));

  if (radius < 1) return `M ${r(x)} ${r(y1)} V ${r(y2)} H ${r(x2)}`;

  return [
    `M ${r(x)} ${r(y1)}`,
    `V ${r(y2 - radius)}`,
    `Q ${r(x)} ${r(y2)} ${r(x + radius)} ${r(y2)}`,
    `H ${r(x2)}`,
  ].join(" ");
}

/** Keep path data compact and free of float noise. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}
