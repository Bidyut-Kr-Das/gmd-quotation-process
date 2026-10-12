import type { PbgRecord } from "@/lib/pbg/pbg-data";
import type { PbgFlowNode } from "@/lib/pbg/pbg-tree-layout";

export type PbgTreeLevel = "client" | "project" | "bg" | "po";

export type PbgTreeSelection = {
  clientName?: string;
  project?: string;
  bgNo?: string;
  poNumber?: string;
};

export type PbgStatusCounts = {
  running: number;
  expired: number;
  closed: number;
  other: number;
};

export type PbgTreeNode = {
  key: string;
  level: PbgTreeLevel;
  /** Display text ("(Blank)" for empty values). */
  label: string;
  /** Raw value used to build the exact-match filter. */
  value: string;
  /** Distinct children at the next level (leaf nodes = row count). */
  count: number;
  /** Selection that this node applies when clicked. */
  selection: PbgTreeSelection;
  /** Date shown on bg/po nodes. */
  date: string | null;
  /** Summed BG amount shown on bg nodes. */
  amount: number | null;
  /** Status breakdown shown on bg nodes. */
  statuses: PbgStatusCounts | null;
  children: PbgTreeNode[];
};

const BLANK_LABEL = "(Blank)";

function displayLabel(value: string): string {
  return value.trim() === "" ? BLANK_LABEL : value;
}

function compareLabels(a: string, b: string): number {
  const aBlank = a.trim() === "";
  const bBlank = b.trim() === "";
  if (aBlank !== bBlank) return aBlank ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

type Group = { value: string; rows: PbgRecord[] };

function groupBy(
  rows: PbgRecord[],
  getValue: (row: PbgRecord) => string,
): Group[] {
  const map = new Map<string, PbgRecord[]>();
  for (const row of rows) {
    const value = getValue(row);
    const bucket = map.get(value);
    if (bucket) bucket.push(row);
    else map.set(value, [row]);
  }
  return Array.from(map.entries())
    .map(([value, groupRows]) => ({ value, rows: groupRows }))
    .sort((a, b) => compareLabels(a.value, b.value));
}

function firstDate(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

function sumAmount(rows: PbgRecord[]): number | null {
  let total = 0;
  let found = false;
  for (const row of rows) {
    if (row.bgAmtFc !== null && row.bgAmtFc !== undefined) {
      total += row.bgAmtFc;
      found = true;
    }
  }
  return found ? total : null;
}

function statusCounts(rows: PbgRecord[]): PbgStatusCounts {
  const counts: PbgStatusCounts = { running: 0, expired: 0, closed: 0, other: 0 };
  for (const row of rows) {
    const status = (row.status ?? "").trim().toLowerCase();
    if (status === "running") counts.running += 1;
    else if (status === "expired") counts.expired += 1;
    else if (status === "closed") counts.closed += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * Builds the Client → Project → BG No → PO Number tree from the raw rows.
 * Children are sorted alphabetically with blanks last; aggregates (BG date,
 * BG amount, status breakdown) are attached to their respective nodes.
 */
export function buildPbgTree(records: PbgRecord[]): PbgTreeNode[] {
  const clientGroups = groupBy(records, (row) => row.clientName ?? "");

  return clientGroups.map((client) => {
    const clientSelection: PbgTreeSelection = { clientName: client.value };
    const projectGroups = groupBy(client.rows, (row) => row.project ?? "");

    return {
      key: `client:${client.value}`,
      level: "client" as const,
      label: displayLabel(client.value),
      value: client.value,
      count: projectGroups.length,
      selection: clientSelection,
      date: null,
      amount: null,
      statuses: null,
      children: projectGroups.map((project) => {
        const projectSelection: PbgTreeSelection = {
          ...clientSelection,
          project: project.value,
        };
        const bgGroups = groupBy(project.rows, (row) => row.bgNo ?? "");

        return {
          key: `client:${client.value}|project:${project.value}`,
          level: "project" as const,
          label: displayLabel(project.value),
          value: project.value,
          count: bgGroups.length,
          selection: projectSelection,
          date: null,
          amount: null,
          statuses: null,
          children: bgGroups.map((bg) => {
            const bgSelection: PbgTreeSelection = {
              ...projectSelection,
              bgNo: bg.value,
            };
            const poGroups = groupBy(bg.rows, (row) => row.poNumber ?? "");

            return {
              key: `client:${client.value}|project:${project.value}|bg:${bg.value}`,
              level: "bg" as const,
              label: displayLabel(bg.value),
              value: bg.value,
              count: poGroups.length,
              selection: bgSelection,
              date: firstDate(bg.rows.map((row) => row.bgDate)),
              amount: sumAmount(bg.rows),
              statuses: statusCounts(bg.rows),
              children: poGroups.map((po) => ({
                key: `client:${client.value}|project:${project.value}|bg:${bg.value}|po:${po.value}`,
                level: "po" as const,
                label: displayLabel(po.value),
                value: po.value,
                count: po.rows.length,
                selection: { ...bgSelection, poNumber: po.value },
                date: firstDate(po.rows.map((row) => row.poDate)),
                amount: null,
                statuses: null,
                children: [],
              })),
            };
          }),
        };
      }),
    };
  });
}

export const SELECTION_ORDER: Array<keyof PbgTreeSelection> = [
  "clientName",
  "project",
  "bgNo",
  "poNumber",
];

export function isSameSelection(
  a: PbgTreeSelection,
  b: PbgTreeSelection,
): boolean {
  return (
    a.clientName === b.clientName &&
    a.project === b.project &&
    a.bgNo === b.bgNo &&
    a.poNumber === b.poNumber
  );
}

export function isEmptySelection(selection: PbgTreeSelection): boolean {
  return (
    selection.clientName === undefined &&
    selection.project === undefined &&
    selection.bgNo === undefined &&
    selection.poNumber === undefined
  );
}

/** True when `ancestor` is a prefix of `full` (root `{}` prefixes everything). */
export function isSelectionPrefix(
  ancestor: PbgTreeSelection,
  full: PbgTreeSelection,
): boolean {
  for (const key of SELECTION_ORDER) {
    if (ancestor[key] !== undefined && ancestor[key] !== full[key]) {
      return false;
    }
  }
  return true;
}

export function isSelectionSelected(
  list: PbgTreeSelection[],
  selection: PbgTreeSelection,
): boolean {
  return list.some((entry) => isSameSelection(entry, selection));
}

/**
 * Toggles `selection` in the list. Clicking the root (`{}`) clears every
 * selection, since the root represents "all rows".
 */
export function toggleSelection(
  list: PbgTreeSelection[],
  selection: PbgTreeSelection,
): PbgTreeSelection[] {
  if (isEmptySelection(selection)) return [];
  if (isSelectionSelected(list, selection)) {
    return list.filter((entry) => !isSameSelection(entry, selection));
  }
  const next = list.filter(
    (entry) =>
      !isSelectionPrefix(entry, selection) &&
      !isSelectionPrefix(selection, entry),
  );
  return [...next, selection];
}

/** A record matches when every level defined in `selection` equals its value. */
export function matchesSelection(
  record: PbgRecord,
  selection: PbgTreeSelection,
): boolean {
  for (const key of SELECTION_ORDER) {
    const expected = selection[key];
    if (expected === undefined) continue;
    const actual = record[key] ?? "";
    if (actual !== expected) return false;
  }
  return true;
}

/** OR across selections; an empty list matches every record. */
export function matchesAnySelection(
  record: PbgRecord,
  list: PbgTreeSelection[],
): boolean {
  if (list.length === 0) return true;
  return list.some((selection) => matchesSelection(record, selection));
}

/** Short human label for a selection chip, e.g. "Client › Project › BG". */
export function describeSelection(selection: PbgTreeSelection): string {
  const parts: string[] = [];
  for (const key of SELECTION_ORDER) {
    const value = selection[key];
    if (value !== undefined) parts.push(value === "" ? "(Blank)" : value);
  }
  return parts.join(" › ");
}

export const PBG_ROOT_KEY = "__pbg_root__";

/**
 * Wraps the client forest in a synthetic "All PBG" root and prunes the branches
 * whose keys are not in `expanded`, producing the tree the chart lays out.
 * Root and all client nodes are always present; deeper levels unfold on demand.
 */
export function toPbgFlowRoot(
  clients: PbgTreeNode[],
  expanded: Set<string>,
): PbgFlowNode {
  const toFlow = (node: PbgTreeNode): PbgFlowNode => {
    const open = expanded.has(node.key);
    return {
      key: node.key,
      level: node.level,
      label: node.label,
      value: node.value,
      count: node.count,
      selection: node.selection,
      date: node.date,
      amount: node.amount,
      statuses: node.statuses,
      hasChildren: node.children.length > 0,
      expanded: open,
      children: open ? node.children.map(toFlow) : [],
    };
  };

  return {
    key: PBG_ROOT_KEY,
    level: "root",
    label: "All PBG",
    value: "",
    count: clients.length,
    selection: {},
    date: null,
    amount: null,
    statuses: null,
    hasChildren: clients.length > 0,
    expanded: true,
    children: clients.map(toFlow),
  };
}

/** Every key in the forest that has children (for Expand all). */
export function collectExpandableKeys(nodes: PbgTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (node: PbgTreeNode) => {
    if (node.children.length > 0) keys.push(node.key);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return keys;
}
