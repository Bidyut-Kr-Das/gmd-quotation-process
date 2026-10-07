"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  toggleParticipationFilter,
  type ParticipationFilter,
} from "@/lib/slices/filtersSlice";
import { resetSelectedDateRange } from "@/lib/slices/filesSlice";
import { deadlineMatchesRange } from "@/components/tender-viewer/participation-cards";
import { dedupeByDocketNo } from "@/lib/docket";
import {
  FLOW_MODE_MIN_WIDTH,
  layoutFlow,
  layoutRail,
  type FlowMode,
} from "@/components/participation-flow/layout";
import {
  ancestorsOf,
  descendantsOf,
  flatten,
  FLOW_TREES,
  type FlowNode,
} from "@/components/participation-flow/tree";
import { FlowEdges } from "@/components/participation-flow/FlowEdges";
import { FlowNodeCard } from "@/components/participation-flow/FlowNodeCard";

interface ParticipationFlowChartProps {
  rows: Record<string, unknown>[];
  onClearAssociation?: () => void;
}

/** Counts keyed by FlowNode.id. */
export type FlowCounts = Record<string, number>;

/**
 * Funnel counts. This is the original counting logic, unchanged in behaviour -
 * only reshaped so the tree renderer can look a count up by node id.
 */
export function computeFlowCounts(
  rows: Record<string, unknown>[],
  from?: string,
  to?: string,
): FlowCounts {
  const participatedRaw = rows.filter(
    (r) =>
      r.apm === "YES" &&
      r.participated === "true" &&
      deadlineMatchesRange(r, from, to),
  );
  // Deduplicate by docketNo before the RA split, so a docket whose rows
  // disagree on reverseAuctionApplicable still counts on one side only.
  const participated = dedupeByDocketNo(
    participatedRaw as unknown as (Record<string, unknown> & { id?: unknown })[],
  ) as unknown as typeof participatedRaw;

  const withRa = participated.filter(
    (r) => r.reverseAuctionApplicable === "true",
  );
  const withoutRa = participated.filter(
    (r) => r.reverseAuctionApplicable !== "true",
  );
  const raDone = withRa.filter(
    (r) => !!r.reverseAuctionStartDate && !!r.reverseAuctionEndDate,
  );
  const raPending = withRa.filter(
    (r) => !r.reverseAuctionStartDate || !r.reverseAuctionEndDate,
  );
  const technicalOpen = withoutRa.filter((r) =>
    [
      "AWARDED",
      "FINANCIAL EVALUATION",
      "TENDER CANCELLED",
      "TECHNICAL BID OPENED",
    ].includes(String(r.currentStatus ?? "").toUpperCase()),
  );
  const technicalNotOpen = withoutRa.filter((r) => {
    if (r.currentStatus == null) return true;
    const s = String(r.currentStatus).trim();
    return s === "" || s.toUpperCase() === "NOT EVALUATED";
  });
  const weL1 = raDone.filter((r) => String(r.ourRank ?? "").trim() === "1");
  const weLost = raDone.filter((r) => String(r.ourRank ?? "").trim() !== "1");
  const expRaDate = raPending.filter(
    (r) => r.expectedRaDate != null && String(r.expectedRaDate).trim() !== "",
  );
  const contractReceived = weL1.filter(
    (r) => r.contractNo != null && String(r.contractNo).trim() !== "",
  );
  const contractPending = weL1.filter(
    (r) => r.contractNo == null || String(r.contractNo).trim() === "",
  );
  const financialOpen = technicalOpen.filter((r) =>
    ["AWARDED", "FINANCIAL EVALUATION", "TENDER CANCELLED"].includes(
      String(r.currentStatus ?? "").trim().toUpperCase(),
    ),
  );
  const financialNotOpen = technicalOpen.filter(
    (r) =>
      !["AWARDED", "FINANCIAL EVALUATION", "TENDER CANCELLED"].includes(
        String(r.currentStatus ?? "").trim().toUpperCase(),
      ),
  );
  const financialWeL1 = financialOpen.filter(
    (r) => String(r.ourRank ?? "").trim() === "1",
  );
  const financialWeLost = financialOpen.filter(
    (r) => String(r.ourRank ?? "").trim() !== "1",
  );
  const financialContractReceived = financialWeL1.filter(
    (r) => r.contractNo != null && String(r.contractNo).trim() !== "",
  );
  const financialContractPending = financialWeL1.filter(
    (r) => r.contractNo == null || String(r.contractNo).trim() === "",
  );

  // Per-node dedupe is kept for deeper nodes: a docket can legitimately match
  // sibling nodes (e.g. one row rank 1 and another rank 2), so it is counted
  // once per node. The root split already ran on deduped rows above.
  const countUnique = (arr: typeof participated) =>
    dedupeByDocketNo(
      arr as unknown as (Record<string, unknown> & { id?: unknown })[],
    ).length;

  return {
    withRa: countUnique(withRa),
    withoutRa: countUnique(withoutRa),
    raDone: countUnique(raDone),
    raPending: countUnique(raPending),
    technicalOpen: countUnique(technicalOpen),
    technicalNotOpen: countUnique(technicalNotOpen),
    weL1: countUnique(weL1),
    weLost: countUnique(weLost),
    expRaDate: countUnique(expRaDate),
    contractReceived: countUnique(contractReceived),
    contractPending: countUnique(contractPending),
    financialOpen: countUnique(financialOpen),
    financialNotOpen: countUnique(financialNotOpen),
    financialWeL1: countUnique(financialWeL1),
    financialWeLost: countUnique(financialWeLost),
    financialContractReceived: countUnique(financialContractReceived),
    financialContractPending: countUnique(financialContractPending),
  };
}

/** Tracks the chart's own width so the layout can adapt to sidebar resizing. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

interface SubtreeProps {
  tree: FlowNode;
  heading: string;
  tone: string;
  counts: FlowCounts;
  mode: FlowMode;
  containerWidth: number;
  isActive: (filter: ParticipationFilter) => boolean;
  onSelect: (tree: FlowNode, node: FlowNode) => void;
}

function FlowSubtree({
  tree,
  heading,
  tone,
  counts,
  mode,
  containerWidth,
  isActive,
  onSelect,
}: SubtreeProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const layout = useMemo(
    () =>
      mode === "flow" ? layoutFlow(tree) : layoutRail(tree, containerWidth),
    [tree, mode, containerWidth],
  );

  const parentCountById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const node of flatten(tree)) {
      for (const kid of node.children ?? []) {
        map[kid.id] = counts[node.id] ?? 0;
      }
    }
    return map;
  }, [tree, counts]);

  const { edgeColors, activeIds, emptyIds } = useMemo(() => {
    const colors: Record<string, string> = {};
    const active = new Set<string>();
    const empty = new Set<string>();
    for (const node of flatten(tree)) {
      colors[node.id] = node.edge;
      if (isActive(node.filter)) active.add(node.id);
      if ((counts[node.id] ?? 0) === 0) empty.add(node.id);
    }
    return { edgeColors: colors, activeIds: active, emptyIds: empty };
  }, [tree, counts, isActive]);

  return (
    <div className="space-y-2">
      <div
        className={`text-[10px] font-semibold uppercase tracking-wider ${tone}`}
      >
        {heading}
      </div>
      <div className={mode === "flow" ? "overflow-x-auto pb-1" : ""}>
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <FlowEdges
            layout={layout}
            edgeColors={edgeColors}
            activeIds={activeIds}
            emptyIds={emptyIds}
            hoveredId={hoveredId}
          />
          {layout.nodes.map((positioned) => {
            const id = positioned.node.id;
            const count = counts[id] ?? 0;
            const parentCount = parentCountById[id];
            const share =
              parentCount === undefined || parentCount === 0
                ? null
                : Math.round((count / parentCount) * 100);
            return (
              <FlowNodeCard
                key={id}
                positioned={positioned}
                mode={mode}
                count={count}
                share={share}
                active={isActive(positioned.node.filter)}
                onSelect={() => onSelect(tree, positioned.node)}
                onHover={setHoveredId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ParticipationFlowChart({
  rows,
  onClearAssociation,
}: ParticipationFlowChartProps) {
  const dispatch = useAppDispatch();
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );
  const participatedDateRange = useAppSelector(
    (s) => s.filters.participatedDateRange,
  );

  const [containerRef, containerWidth] = useMeasuredWidth();

  const counts = useMemo(
    () =>
      computeFlowCounts(
        rows,
        participatedDateRange?.from,
        participatedDateRange?.to,
      ),
    [rows, participatedDateRange],
  );

  const isActive = useCallback(
    (filter: ParticipationFilter) => participationFilters.includes(filter),
    [participationFilters],
  );

  /**
   * One handler for every node. Ancestry now comes from the tree data itself,
   * replacing the two hand-maintained parentMap/childrenMap tables and the
   * duplicate handleFinancialWeClick the previous version carried.
   */
  const handleSelect = useCallback(
    (tree: FlowNode, node: FlowNode) => {
      const turningOff = participationFilters.includes(node.filter);

      if (turningOff) {
        // Clearing a node also clears everything below it, so the filter set
        // can never be left narrowed by an orphaned descendant.
        const doomed = [
          node.filter,
          ...descendantsOf(tree, node.id).map((n) => n.filter),
        ];
        for (const filter of doomed) {
          if (participationFilters.includes(filter)) {
            dispatch(toggleParticipationFilter(filter));
          }
        }
      } else {
        if (!participationFilters.includes("participatedTotal")) {
          dispatch(toggleParticipationFilter("participatedTotal"));
        }
        const needed = [
          ...ancestorsOf(tree, node.id).map((n) => n.filter),
          node.filter,
        ];
        for (const filter of needed) {
          if (!participationFilters.includes(filter)) {
            dispatch(toggleParticipationFilter(filter));
          }
        }
      }

      dispatch(resetSelectedDateRange());
      onClearAssociation?.();
    },
    [dispatch, participationFilters, onClearAssociation],
  );

  const mode: FlowMode =
    containerWidth >= FLOW_MODE_MIN_WIDTH ? "flow" : "rail";

  return (
    <div ref={containerRef} className="space-y-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
        Participation Flow
      </div>

      {containerWidth > 0 &&
        FLOW_TREES.map(({ tree, heading, tone }) => (
          <FlowSubtree
            key={tree.id}
            tree={tree}
            heading={heading}
            tone={tone}
            counts={counts}
            mode={mode}
            containerWidth={containerWidth}
            isActive={isActive}
            onSelect={handleSelect}
          />
        ))}
    </div>
  );
}
