import type { PbgStatusCounts, PbgTreeSelection } from "@/lib/pbg/pbg-tree";

export type PbgFlowLevel = "root" | "client" | "project" | "bg" | "po";

/**
 * A node ready for left-to-right org-chart layout. Mirrors `PbgTreeNode` but
 * carries the visual/expansion state the chart needs.
 */
export type PbgFlowNode = {
  key: string;
  level: PbgFlowLevel;
  label: string;
  value: string;
  /** Distinct children at the next level (leaf = row count). */
  count: number;
  selection: PbgTreeSelection;
  date: string | null;
  amount: number | null;
  statuses: PbgStatusCounts | null;
  hasChildren: boolean;
  expanded: boolean;
  children: PbgFlowNode[];
};

export interface PbgFlowGeometry {
  nodeWidth: number;
  nodeHeight: number;
  colGap: number;
  rowGap: number;
}

export interface PbgPositionedNode {
  node: PbgFlowNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PbgPositionedEdge {
  id: string;
  parentKey: string;
  childKey: string;
  path: string;
}

export interface PbgFlowLayout {
  nodes: PbgPositionedNode[];
  edges: PbgPositionedEdge[];
  width: number;
  height: number;
}

export const DEFAULT_PBG_FLOW_GEOMETRY: PbgFlowGeometry = {
  nodeWidth: 184,
  nodeHeight: 42,
  colGap: 40,
  rowGap: 10,
};

const CORNER = 10;

/**
 * Tidy-tree placement, left-to-right: depth drives the x column, leaves are
 * assigned sequential rows and every parent is centred on the span of its
 * children. Pure computation - no DOM measurement - so the edge paths land
 * exactly on node edges.
 */
export function layoutPbgFlow(
  root: PbgFlowNode,
  geometry: PbgFlowGeometry = DEFAULT_PBG_FLOW_GEOMETRY,
): PbgFlowLayout {
  const nodes: PbgPositionedNode[] = [];
  const byKey = new Map<string, PbgPositionedNode>();
  const stride = geometry.nodeHeight + geometry.rowGap;
  let leafCursor = 0;
  let maxDepth = 0;

  const place = (node: PbgFlowNode, depth: number): PbgPositionedNode => {
    maxDepth = Math.max(maxDepth, depth);

    let y: number;
    if (node.children.length === 0) {
      y = leafCursor * stride;
      leafCursor += 1;
    } else {
      const placed = node.children.map((child) => place(child, depth + 1));
      y = (placed[0].y + placed[placed.length - 1].y) / 2;
    }

    const positioned: PbgPositionedNode = {
      node,
      depth,
      x: depth * (geometry.nodeWidth + geometry.colGap),
      y,
      width: geometry.nodeWidth,
      height: geometry.nodeHeight,
    };
    nodes.push(positioned);
    byKey.set(node.key, positioned);
    return positioned;
  };

  place(root, 0);

  return {
    nodes,
    edges: buildEdges(root, byKey),
    width: (maxDepth + 1) * geometry.nodeWidth + maxDepth * geometry.colGap,
    height: Math.max(0, leafCursor * stride - geometry.rowGap),
  };
}

function buildEdges(
  root: PbgFlowNode,
  byKey: Map<string, PbgPositionedNode>,
): PbgPositionedEdge[] {
  const edges: PbgPositionedEdge[] = [];

  const walk = (node: PbgFlowNode) => {
    const parent = byKey.get(node.key);
    for (const child of node.children) {
      const childNode = byKey.get(child.key);
      if (parent && childNode) {
        edges.push({
          id: `${node.key}->${child.key}`,
          parentKey: node.key,
          childKey: child.key,
          path: elbowPath(parent, childNode),
        });
      }
      walk(child);
    }
  };

  walk(root);
  return edges;
}

/**
 * Parent right edge -> child left edge with two rounded doglegs. The command
 * shape is fixed (M, H, Q, V, Q, H) so the `d` value stays interpolable and
 * can be CSS-transitioned as the layout changes.
 */
function elbowPath(
  parent: PbgPositionedNode,
  child: PbgPositionedNode,
): string {
  const x1 = parent.x + parent.width;
  const y1 = parent.y + parent.height / 2;
  const x2 = child.x;
  const y2 = child.y + child.height / 2;
  const midX = x1 + (x2 - x1) / 2;
  const dy = y2 - y1;
  const dir = dy >= 0 ? 1 : -1;
  const radius = Math.min(
    CORNER,
    Math.abs(dy) / 2,
    Math.abs(midX - x1),
    Math.abs(x2 - midX),
  );

  return [
    `M ${r(x1)} ${r(y1)}`,
    `H ${r(midX - radius)}`,
    `Q ${r(midX)} ${r(y1)} ${r(midX)} ${r(y1 + dir * radius)}`,
    `V ${r(y2 - dir * radius)}`,
    `Q ${r(midX)} ${r(y2)} ${r(midX + radius)} ${r(y2)}`,
    `H ${r(x2)}`,
  ].join(" ");
}

function r(value: number): number {
  return Math.round(value * 100) / 100;
}
