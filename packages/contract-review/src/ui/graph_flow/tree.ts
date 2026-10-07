/**
 * A node in the contract-review flow diagram.
 *
 * `id` doubles as the key into the counts record built by the chart, so it is
 * unique across the whole diagram; `filter` is the column/value constraint the
 * node applies to the table (path-based: clicking a node ANDs the whole
 * ancestor chain with the node's own filter).
 */
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_ZERO,
  FLOW_NON_ZERO,
} from "@gmd/dashboard/lib/flowFilter";

export interface FlowFilter {
  /** Display header the filter targets, e.g. "STATUS". */
  column: string;
  /** Exact trimmed cell values. "(Blank)" matches the empty string. */
  values: string[];
}

/**
 * Live rows: STATUS blank. Used as LIVE_TREE's root filter and as the
 * tree-level scope of every mini-graph, so "Live" is defined once.
 */
export const LIVE_SCOPE: FlowFilter = { column: "STATUS", values: ["(Blank)"] };

export interface FlowNode {
  id: string;
  filter: FlowFilter;
  label: string;
  /** Tailwind text colour for the count. */
  accent: string;
  /** Stroke colour used for this node's incoming edge when the path is live. */
  edge: string;
  /**
   * Optional display metric computed by the page for this node (e.g. a summed
   * amount). The node's `filter` still drives counting/filtering; the metric is
   * shown as the node's big number instead of the raw row count.
   */
  metric?: "diBalance";
  children?: FlowNode[];
}

export const LIVE_TREE: FlowNode = {
  id: "live",
  filter: LIVE_SCOPE,
  label: "Live",
  accent: "text-cyan-300",
  edge: "rgb(103 232 249)",
  children: [
    {
      id: "liveApproved",
      filter: { column: "CLEARANCE STATUS", values: ["APPROVED"] },
      label: "Approved",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
      children: [
        {
          id: "mcreceived",
          filter: { column: "MC Received/Pending", values: ["Received"] },
          label: "MC Received",
          accent: "text-emerald-300",
          edge: "rgb(110 231 183)",
          children: [
            {
              id: "inspcallraised",
              filter: { column: "OFFER NUMBER", values: [FLOW_HAS_VALUE] },
              label: "Inspection Call Raised",
              accent: "text-amber-300",
              edge: "rgb(252 211 77)",
              children: [
                {
                  id: "inspectionDone",
                  filter: {
                    column: "INSPECTION NUMBER",
                    values: [FLOW_HAS_VALUE],
                  },
                  label: "Inspection Done",
                  accent: "text-emerald-300",
                  edge: "rgb(110 231 183)",
                  children: [
                    {
                      id: "diReceived",
                      filter: { column: "DI DATE", values: [FLOW_HAS_VALUE] },
                      label: "DI Received",
                      accent: "text-emerald-300",
                      edge: "rgb(110 231 183)",
                      children: [
                        {
                          id: "dispatchDone",
                          filter: {
                            column: "BAL BILL AG CONT",
                            values: [FLOW_ZERO],
                          },
                          label: "Dispatch Done",
                          accent: "text-emerald-300",
                          edge: "rgb(110 231 183)",
                        },
                        {
                          id: "dispatchPending",
                          filter: {
                            column: "BAL BILL AG CONT",
                            values: [FLOW_NON_ZERO],
                          },
                          label: "Dispatch Pending",
                          accent: "text-rose-300",
                          edge: "rgb(253 164 175)",
                          children: [
                            {
                              id: "balDi",
                              filter: {
                                column: "DI DATE",
                                values: [FLOW_HAS_VALUE],
                              },
                              label: "Balance DI",
                              accent: "text-rose-300",
                              edge: "rgb(253 164 175)",
                              metric: "diBalance",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      id: "diPending",
                      filter: { column: "DI DATE", values: [FLOW_NO_VALUE] },
                      label: "DI Pending",
                      accent: "text-rose-300",
                      edge: "rgb(253 164 175)",
                    },
                  ],
                },
                {
                  id: "inspectionPending",
                  filter: {
                    column: "INSPECTION NUMBER",
                    values: [FLOW_NO_VALUE],
                  },
                  label: "Inspection Pending",
                  accent: "text-amber-300",
                  edge: "rgb(252 211 77)",
                },
              ],
            },
            {
              id: "inspcallpending",
              filter: { column: "OFFER NUMBER", values: [FLOW_NO_VALUE] },
              label: "Inspection Call Pending",
              accent: "text-amber-300",
              edge: "rgb(252 211 77)",
            },
          ],
          // children: [
          //   {
          //     id: "mcreceivedRma",
          //     filter: { column: "RM AVAIL", values: ["SA"] },
          //     label: "RMA",
          //     accent: "text-emerald-300",
          //     edge: "rgb(110 231 183)",

          //   },
          //   {
          //     id: "mcreceivedRmna",
          //     filter: { column: "RM AVAIL", values: ["Not available"] },
          //     label: "RM NA",
          //     accent: "text-rose-300",
          //     edge: "rgb(253 164 175)",
          //   },
          // ],
        },
        {
          id: "mcpending",
          filter: { column: "MC Received/Pending", values: ["Pending"] },
          label: "MC Pending",
          accent: "text-amber-300",
          edge: "rgb(252 211 77)",
          // children: [
          //   {
          //     id: "mcpendingRma",
          //     filter: { column: "RM AVAIL", values: ["SA"] },
          //     label: "RMA",
          //     accent: "text-emerald-300",
          //     edge: "rgb(110 231 183)",
          //   },
          //   {
          //     id: "mcpendingRmna",
          //     filter: { column: "RM AVAIL", values: ["Not available"] },
          //     label: "RM NA",
          //     accent: "text-rose-300",
          //     edge: "rgb(253 164 175)",
          //   },
          // ],
        },
      ],
    },

    {
      id: "livePending",
      filter: { column: "CLEARANCE STATUS", values: ["PENDING", ""] },
      label: "Pending",
      accent: "text-amber-300",
      edge: "rgb(252 211 77)",
      // children: [
      //   {
      //     id: "pendingRma",
      //     filter: { column: "RM AVAIL", values: ["SA"] },
      //     label: "RMA",
      //     accent: "text-emerald-300",
      //     edge: "rgb(110 231 183)",
      //   },
      //   {
      //     id: "pendingRmna",
      //     filter: { column: "RM AVAIL", values: ["Not available"] },
      //     label: "RM NA",
      //     accent: "text-rose-300",
      //     edge: "rgb(253 164 175)",
      //   },
      // ],
    },
  ],
};

export const CLOSED_TREE: FlowNode = {
  id: "closed",
  filter: { column: "STATUS", values: ["CLOSED", "closed"] },
  label: "Closed",
  accent: "text-rose-300",
  edge: "rgb(253 164 175)",
};

export const InspectionCalledRaisedTree: FlowNode = {
  id: "inspectionCalledRaised",
  filter: { column: "OFFER NUMBER", values: [FLOW_HAS_VALUE] },
  label: "IC Raised",
  accent: "text-blue-300",
  edge: "rgb(147 197 253)",
  children: [
    {
      id: "inspectioncallRaisedRma",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "inspectioncallRaisedRmna",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const InspectionDoneTree: FlowNode = {
  id: "inspectioncallDone",
  filter: { column: "Inspection", values: ["DONE"] },
  label: "IC Done",
  accent: "text-emerald-300",
  edge: "rgb(110 231 183)",
  children: [
    {
      id: "inspectioncallDoneRma",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "inspectioncallDoneRmna",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const InspectionPendingTree: FlowNode = {
  id: "inspectioncallPending",
  filter: { column: "Inspection", values: ["PENDING"] },
  label: "IC Pending",
  accent: "text-amber-300",
  edge: "rgb(252 211 77)",
  children: [
    {
      id: "inspectioncallPendingRma",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "inspectioncallPendingRmna",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const MCpendingTree: FlowNode = {
  id: "mcpending2",
  filter: { column: "MC Received/Pending", values: ["Pending"] },
  label: "MC Pending",
  accent: "text-amber-300",
  edge: "rgb(252 211 77)",
  children: [
    {
      id: "mcpendingRma2",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "mcpendingRmna2",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const MCreceivedTree: FlowNode = {
  id: "mcreceived2",
  filter: { column: "MC Received/Pending", values: ["Received"] },
  label: "MC Received",
  accent: "text-emerald-300",
  edge: "rgb(110 231 183)",
  children: [
    {
      id: "mcreceivedRma2",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "mcreceivedRmna2",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const clearancePendingTree: FlowNode = {
  id: "livePending1",
  filter: { column: "CLEARANCE STATUS", values: ["PENDING", ""] },
  label: "Pending",
  accent: "text-amber-300",
  edge: "rgb(252 211 77)",
  children: [
    {
      id: "pendingRma",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "pendingRmna",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const DIReceivedTree: FlowNode = {
  id: "recDi",
  filter: { column: "DI DATE", values: [FLOW_HAS_VALUE] },
  label: "DI Received",
  accent: "text-emerald-300",
  edge: "rgb(110 231 183)",
  children: [
    {
      id: "recDiRma",
      filter: { column: "RM AVAIL", values: ["SA"] },
      label: "RMA",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
    },
    {
      id: "recDiRmna",
      filter: { column: "RM AVAIL", values: ["Not available"] },
      label: "RM NA",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const CONTRACT_REVIEW_TREES: {
  tree: FlowNode;
  /**
   * Row constraint ANDed onto every node of this tree. A node's own `filter` is
   * single-column, so this is how the mini-graphs are scoped to Live rows
   * without adding a level to their shape.
   */
  scope?: FlowFilter;
  heading: string;
  tone: string;
}[] = [
  { tree: LIVE_TREE, heading: "Live", tone: "text-cyan-300/80" },
  { tree: CLOSED_TREE, heading: "Closed", tone: "text-rose-300/80" },
  {
    tree: InspectionCalledRaisedTree,
    scope: LIVE_SCOPE,
    heading: "Inspection Called Raised",
    tone: "text-blue-300/80",
  },
  {
    tree: InspectionDoneTree,
    scope: LIVE_SCOPE,
    heading: "Inspection Done",
    tone: "text-emerald-300/80",
  },
  {
    tree: InspectionPendingTree,
    scope: LIVE_SCOPE,
    heading: "Inspection Pending",
    tone: "text-amber-300/80",
  },
  {
    tree: clearancePendingTree,
    scope: LIVE_SCOPE,
    heading: "Clearance Pending",
    tone: "text-amber-300/80",
  },
  {
    tree: MCpendingTree,
    scope: LIVE_SCOPE,
    heading: "MC Pending",
    tone: "text-amber-300/80",
  },
  {
    tree: MCreceivedTree,
    scope: LIVE_SCOPE,
    heading: "MC Received",
    tone: "text-emerald-300/80",
  },
  {
    tree: DIReceivedTree,
    scope: LIVE_SCOPE,
    heading: "DI Received",
    tone: "text-emerald-300/80",
  },
];

/** Every node of a tree, depth-first. */
export function flatten(node: FlowNode): FlowNode[] {
  const out: FlowNode[] = [node];
  for (const kid of node.children ?? []) out.push(...flatten(kid));
  return out;
}

/**
 * Ancestor chain for a node id, root first, excluding the node itself.
 * Replaces the two hand-maintained parentMap/childrenMap tables the old chart
 * carried, which had drifted out of sync with the rendered tree.
 */
export function ancestorsOf(root: FlowNode, id: string): FlowNode[] {
  const trail: FlowNode[] = [];
  const walk = (node: FlowNode): boolean => {
    if (node.id === id) return true;
    for (const kid of node.children ?? []) {
      trail.push(node);
      if (walk(kid)) return true;
      trail.pop();
    }
    return false;
  };
  return walk(root) ? trail : [];
}

/** Every descendant of a node id, excluding the node itself. */
export function descendantsOf(root: FlowNode, id: string): FlowNode[] {
  const found = flatten(root).find((n) => n.id === id);
  if (!found) return [];
  return (found.children ?? []).flatMap((kid) => flatten(kid));
}

/** Full path for a node id, root first, including the node itself. */
export function pathTo(root: FlowNode, id: string): FlowNode[] {
  return [...ancestorsOf(root, id), findById(root, id)].filter(
    (n): n is FlowNode => !!n,
  );
}

function findById(node: FlowNode, id: string): FlowNode | null {
  if (node.id === id) return node;
  for (const kid of node.children ?? []) {
    const found = findById(kid, id);
    if (found) return found;
  }
  return null;
}

/**
 * Drops nodes whose filter targets a disabled column (and everything below
 * them). Returns null when the root itself is filtered on a disabled column.
 */
export function pruneTree(
  node: FlowNode,
  isEnabled: (column: string) => boolean,
): FlowNode | null {
  if (!isEnabled(node.filter.column)) return null;
  if (!node.children) return node;
  const children = node.children
    .map((kid) => pruneTree(kid, isEnabled))
    .filter((kid): kid is FlowNode => kid !== null);
  return { ...node, children };
}

/** CONTRACT_REVIEW_TREES with disabled-column nodes removed. */
export function enabledTrees(isEnabled: (column: string) => boolean) {
  return CONTRACT_REVIEW_TREES.flatMap((t) => {
    if (t.scope && !isEnabled(t.scope.column)) return [];
    const tree = pruneTree(t.tree, isEnabled);
    return tree ? [{ ...t, tree }] : [];
  });
}
