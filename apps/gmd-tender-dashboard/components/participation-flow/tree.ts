import type { ParticipationFilter } from "@/lib/slices/filtersSlice";

/**
 * A node in the participation funnel.
 *
 * `id` doubles as the key into the counts record built by the chart, so it is
 * unique across the whole diagram; `filter` is the Redux filter the node
 * toggles. The two differ for the branch roots (id `withRa` toggles
 * `participatedWithRa`).
 */
export interface FlowNode {
  id: string;
  filter: ParticipationFilter;
  label: string;
  /** Tailwind text colour for the count. */
  accent: string;
  /** Stroke colour used for this node's incoming edge when the path is live. */
  edge: string;
  children?: FlowNode[];
}

export const WITH_RA_TREE: FlowNode = {
  id: "withRa",
  filter: "participatedWithRa",
  label: "With RA",
  accent: "text-violet-300",
  edge: "rgb(196 181 253)",
  children: [
    {
      id: "raDone",
      filter: "raDone",
      label: "RA Done",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
      children: [
        {
          id: "weL1",
          filter: "weL1",
          label: "We L1",
          accent: "text-emerald-300",
          edge: "rgb(110 231 183)",
          children: [
            {
              id: "contractReceived",
              filter: "contractReceived",
              label: "Contract Received",
              accent: "text-teal-300",
              edge: "rgb(94 234 212)",
            },
            {
              id: "contractPending",
              filter: "contractPending",
              label: "Contract Pending",
              accent: "text-orange-300",
              edge: "rgb(253 186 116)",
            },
          ],
        },
        {
          id: "weLost",
          filter: "weLost",
          label: "We Lost",
          accent: "text-rose-300",
          edge: "rgb(253 164 175)",
        },
      ],
    },
    {
      id: "raPending",
      filter: "raPending",
      label: "RA Pending",
      accent: "text-amber-300",
      edge: "rgb(252 211 77)",
      children: [
        {
          id: "expRaDate",
          filter: "expRaDate",
          label: "Exp RA Date",
          accent: "text-sky-300",
          edge: "rgb(125 211 252)",
        },
      ],
    },
  ],
};

export const WITHOUT_RA_TREE: FlowNode = {
  id: "withoutRa",
  filter: "participatedWithoutRa",
  label: "Without RA",
  accent: "text-cyan-300",
  edge: "rgb(103 232 249)",
  children: [
    {
      id: "technicalOpen",
      filter: "technicalOpen",
      label: "Technical Open",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
      children: [
        {
          id: "financialOpen",
          filter: "financialOpen",
          label: "Financial Open",
          accent: "text-amber-300",
          edge: "rgb(252 211 77)",
          children: [
            {
              id: "financialWeL1",
              filter: "financialWeL1",
              label: "We L1",
              accent: "text-emerald-300",
              edge: "rgb(110 231 183)",
              children: [
                {
                  id: "financialContractReceived",
                  filter: "financialContractReceived",
                  label: "Contract Received",
                  accent: "text-teal-300",
                  edge: "rgb(94 234 212)",
                },
                {
                  id: "financialContractPending",
                  filter: "financialContractPending",
                  label: "Contract Pending",
                  accent: "text-orange-300",
                  edge: "rgb(253 186 116)",
                },
              ],
            },
            {
              id: "financialWeLost",
              filter: "financialWeLost",
              label: "We Lost",
              accent: "text-rose-300",
              edge: "rgb(253 164 175)",
            },
          ],
        },
        {
          id: "financialNotOpen",
          filter: "financialNotOpen",
          label: "Financial Not Open",
          accent: "text-slate-300",
          edge: "rgb(203 213 225)",
        },
      ],
    },
    {
      id: "technicalNotOpen",
      filter: "technicalNotOpen",
      label: "Technical Not Open",
      accent: "text-rose-300",
      edge: "rgb(253 164 175)",
    },
  ],
};

export const FLOW_TREES: { tree: FlowNode; heading: string; tone: string }[] = [
  { tree: WITH_RA_TREE, heading: "With RA", tone: "text-violet-300/80" },
  { tree: WITHOUT_RA_TREE, heading: "Without RA", tone: "text-cyan-300/80" },
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
