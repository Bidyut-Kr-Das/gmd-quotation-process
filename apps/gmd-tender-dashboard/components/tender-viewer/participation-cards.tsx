"use client";

import { useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  toggleParticipationFilter,
  clearParticipationFilters,
  setColumnFilter,
  clearColumnFilter,
  setParticipatedDateRange,
  clearParticipatedDateRange,
  type ParticipationFilter,
} from "@/lib/slices/filtersSlice";
import { resetSelectedDateRange } from "@/lib/slices/filesSlice";
import { CheckCircle2, X } from "lucide-react";
import { toISTDateKey } from "@/lib/format-ist";
import { dedupeByDocketNo } from "@/lib/docket";

export function isParticipatedRow(row: Record<string, unknown>): boolean {
  return row.apm === "YES" && row.participated === "true";
}

export function isParticipatedTotalRow(row: Record<string, unknown>): boolean {
  return row.apm === "YES" && row.participated === "true";
}

export function isRaDoneRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    row.reverseAuctionApplicable === "true" &&
    !!row.reverseAuctionStartDate &&
    !!row.reverseAuctionEndDate
  );
}

export function isRaPendingRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    row.reverseAuctionApplicable === "true" &&
    (!row.reverseAuctionStartDate || !row.reverseAuctionEndDate)
  );
}

const TECHNICAL_OPEN_STATUSES = [
  "AWARDED",
  "FINANCIAL EVALUATION",
  "TENDER CANCELLED",
  "TECHNICAL BID OPENED",
];

export function isTechnicalOpenRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  const status = String(row.currentStatus ?? "").toUpperCase();
  return TECHNICAL_OPEN_STATUSES.includes(status);
}

export function isTechnicalNotOpenRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  const raw = row.currentStatus;
  if (raw == null) return true;
  const status = String(raw).trim();
  if (status === "") return true;
  return status.toUpperCase() === "NOT EVALUATED";
}

const FINANCIAL_OPEN_STATUSES = [
  "AWARDED",
  "FINANCIAL EVALUATION",
  "TENDER CANCELLED",
];

export function isFinancialOpenRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  const status = String(row.currentStatus ?? "").trim().toUpperCase();
  return FINANCIAL_OPEN_STATUSES.includes(status);
}

export function isFinancialNotOpenRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  if (row.reverseAuctionApplicable === "true") return false;
  const status = String(row.currentStatus ?? "").trim().toUpperCase();
  if (!TECHNICAL_OPEN_STATUSES.includes(status)) return false;
  return !FINANCIAL_OPEN_STATUSES.includes(status);
}

export function isWeL1Row(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    String(row.ourRank ?? "").trim() === "1"
  );
}

export function isWeLostRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    String(row.ourRank ?? "").trim() !== "1"
  );
}

export function isExpRaDateRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    row.reverseAuctionApplicable === "true" &&
    (!row.reverseAuctionStartDate || !row.reverseAuctionEndDate) &&
    row.expectedRaDate != null &&
    String(row.expectedRaDate).trim() !== ""
  );
}

export function isContractReceivedRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    String(row.ourRank ?? "").trim() === "1" &&
    row.contractNo != null &&
    String(row.contractNo).trim() !== ""
  );
}

export function isContractPendingRow(row: Record<string, unknown>): boolean {
  return (
    row.participated === "true" &&
    String(row.ourRank ?? "").trim() === "1" &&
    (row.contractNo == null || String(row.contractNo).trim() === "")
  );
}

/**
 * Financial-branch variants of the We L1 / We Lost / contract nodes.
 *
 * The plain isWeL1Row/isContractReceivedRow predicates are branch-agnostic -
 * they only produce branch-correct results because the flow chart AND-s them
 * with their whole ancestor chain. These four are self-contained so the two
 * subtrees of the flow chart can be selected independently of each other.
 */
function isFinancialBranchRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  if (row.reverseAuctionApplicable === "true") return false;
  const status = String(row.currentStatus ?? "").trim().toUpperCase();
  return FINANCIAL_OPEN_STATUSES.includes(status);
}

export function isFinancialWeL1Row(row: Record<string, unknown>): boolean {
  return isFinancialBranchRow(row) && String(row.ourRank ?? "").trim() === "1";
}

export function isFinancialWeLostRow(row: Record<string, unknown>): boolean {
  return isFinancialBranchRow(row) && String(row.ourRank ?? "").trim() !== "1";
}

export function isFinancialContractReceivedRow(
  row: Record<string, unknown>,
): boolean {
  return (
    isFinancialWeL1Row(row) &&
    row.contractNo != null &&
    String(row.contractNo).trim() !== ""
  );
}

export function isFinancialContractPendingRow(
  row: Record<string, unknown>,
): boolean {
  return (
    isFinancialWeL1Row(row) &&
    (row.contractNo == null || String(row.contractNo).trim() === "")
  );
}

export function isNotParticipatedRow(
  row: Record<string, unknown>,
): boolean {
  return (
    row.apm === "YES" &&
    row.participated !== "true" &&
    row.participated !== "false"
  );
}

export function isNotParticipatedWithUpcomingDeadline(
  row: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  if (row.apm !== "YES") return false;
  if (row.participated === "true" || row.participated === "false") return false;
  const deadline = String(row.deadline ?? "");
  if (!deadline) return false;
  const key = toISTDateKey(deadline);
  const todayKey = toISTDateKey(now);
  if (!key || !todayKey) return false;
  return key >= todayKey;
}

export function deadlineMatchesRange(
  row: Record<string, unknown>,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  const deadline = String(row.deadline ?? "");
  if (!deadline) return false;
  const key = toISTDateKey(deadline);
  if (!key) return false;
  const fromKey = from ? toISTDateKey(from) : null;
  const toKey = to ? toISTDateKey(to) : null;
  const effectiveFrom = fromKey ?? (from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null);
  const effectiveTo = toKey ?? (to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null);
  if (effectiveFrom && key < effectiveFrom) return false;
  if (effectiveTo && key > effectiveTo) return false;
  return true;
}

export function isUpcomingRaRow(
  row: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  if (row.reverseAuctionApplicable !== "true") return false;
  const start = String(row.reverseAuctionStartDate ?? "");
  if (!start) return false;
  const date = new Date(start);
  if (isNaN(date.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date >= today;
}

export function isParticipatedWithRaRow(row: Record<string, unknown>): boolean {
  return row.participated === "true" && row.reverseAuctionApplicable === "true";
}

export function isParticipatedWithoutRaRow(row: Record<string, unknown>): boolean {
  return row.participated === "true" && row.reverseAuctionApplicable !== "true";
}

export function isYetToOpenRaRow(
  row: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  if (row.participated !== "true") return false;
  if (row.reverseAuctionApplicable !== "true") return false;
  const start = String(row.reverseAuctionStartDate ?? "");
  if (!start) return false;
  const date = new Date(start);
  if (isNaN(date.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date > today;
}

export function isBidOpeningPendingExclRaRow(row: Record<string, unknown>): boolean {
  if (row.participated !== "true") return false;
  if (row.reverseAuctionApplicable === "true") return false;
  const status = String(row.currentStatus ?? "").toUpperCase();
  if (status === "AWARDED" || status === "FINANCIAL EVALUATION") return false;
  return true;
}

type ParticipationPredicate = (row: Record<string, unknown>) => boolean;

/**
 * Exhaustive map from filter key to predicate. Declared as a full Record so
 * that adding a member to ParticipationFilter is a compile error until it is
 * handled here - the previous if-chain fell through to `return true`, which
 * made a forgotten key silently match every row.
 */
const PARTICIPATION_PREDICATES: Record<
  ParticipationFilter,
  ParticipationPredicate
> = {
  participated: isParticipatedRow,
  participatedTotal: isParticipatedTotalRow,
  notParticipated: isNotParticipatedRow,
  upcomingRa: isUpcomingRaRow,
  participatedWithRa: isParticipatedWithRaRow,
  participatedWithoutRa: isParticipatedWithoutRaRow,
  yetToOpenRa: isYetToOpenRaRow,
  bidOpeningPendingExclRa: isBidOpeningPendingExclRaRow,
  raDone: isRaDoneRow,
  raPending: isRaPendingRow,
  technicalOpen: isTechnicalOpenRow,
  technicalNotOpen: isTechnicalNotOpenRow,
  weL1: isWeL1Row,
  weLost: isWeLostRow,
  expRaDate: isExpRaDateRow,
  contractReceived: isContractReceivedRow,
  contractPending: isContractPendingRow,
  financialOpen: isFinancialOpenRow,
  financialNotOpen: isFinancialNotOpenRow,
  financialWeL1: isFinancialWeL1Row,
  financialWeLost: isFinancialWeLostRow,
  financialContractReceived: isFinancialContractReceivedRow,
  financialContractPending: isFinancialContractPendingRow,
};

function matchesSingleFilter(
  row: Record<string, unknown>,
  filter: ParticipationFilter,
): boolean {
  const predicate = PARTICIPATION_PREDICATES[filter];
  return predicate ? predicate(row) : true;
}

export function matchesParticipationFilter(
  row: Record<string, unknown>,
  filters: ParticipationFilter[],
): boolean {
  if (filters.length === 0) return true;
  return filters.every((f) => matchesSingleFilter(row, f));
}

type CardValue = ParticipationFilter;

interface ParticipationCardsProps {
  rows: Record<string, unknown>[];
  variant?: "light" | "dark";
  onClearAssociation?: () => void;
}

export function ParticipationCards({
  rows,
  variant = "light",
  onClearAssociation,
}: ParticipationCardsProps) {
  const dispatch = useAppDispatch();
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );
  const participatedDateRange = useAppSelector(
    (s) => s.filters.participatedDateRange,
  );

  const counts = useMemo(() => {
    const participatedRaw = rows.filter(
      (row) =>
        isParticipatedRow(row) &&
        deadlineMatchesRange(
          row,
          participatedDateRange?.from,
          participatedDateRange?.to,
        ),
    );
    const participated = dedupeByDocketNo(
      participatedRaw as unknown as (Record<string, unknown> & {
        id?: unknown;
      })[],
    ) as unknown as typeof participatedRaw;
    return {
      participated: participated.length,
    };
  }, [rows, participatedDateRange]);

  const handleCardClick = (value: CardValue) => {
    dispatch(toggleParticipationFilter(value));
    dispatch(resetSelectedDateRange());
    onClearAssociation?.();
  };

  const handleParticipatedRangeChange = (
    value: string,
    which: "from" | "to",
  ) => {
    const from =
      which === "from" ? value : (participatedDateRange?.from ?? "");
    const to = which === "to" ? value : (participatedDateRange?.to ?? "");
    dispatch(setParticipatedDateRange({ from, to }));
    dispatch(
      clearColumnFilter({
        accessor: "deadline",
        filterType: "select",
      }),
    );
    dispatch(
      setColumnFilter({
        accessor: "deadline",
        filterType: "dateRange",
        value: { startDate: from, endDate: to },
      }),
    );
    dispatch(resetSelectedDateRange());
    onClearAssociation?.();
  };

  const handleClearParticipatedRange = () => {
    dispatch(clearParticipatedDateRange());
    dispatch(
      clearColumnFilter({
        accessor: "deadline",
        filterType: "dateRange",
      }),
    );
  };

  const cards: {
    value: CardValue;
    label: string;
    count: number;
    icon: typeof CheckCircle2;
    iconClass: string;
  }[] = [
    {
      value: "participated",
      label: "Participated",
      count: counts.participated,
      icon: CheckCircle2,
      iconClass: "text-emerald-600",
    },
  ];

  const isDark = variant === "dark";

  const rangeInputs = (
    <div
      className="mt-2 flex w-full flex-col gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="date"
        className={
          isDark
            ? "w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark] focus:border-white/40 focus:outline-none"
            : "date-filter-input w-full"
        }
        style={isDark ? undefined : { flex: "none" }}
        value={participatedDateRange?.from ?? ""}
        onChange={(e) => handleParticipatedRangeChange(e.target.value, "from")}
        title="Start Date"
      />
      <input
        type="date"
        className={
          isDark
            ? "w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark] focus:border-white/40 focus:outline-none"
            : "date-filter-input w-full"
        }
        style={isDark ? undefined : { flex: "none" }}
        value={participatedDateRange?.to ?? ""}
        onChange={(e) => handleParticipatedRangeChange(e.target.value, "to")}
        title="End Date"
      />
      {(participatedDateRange?.from || participatedDateRange?.to) && (
        <button
          type="button"
          className={
            isDark
              ? "flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
              : "date-filter-clear-btn"
          }
          title="Clear date filter"
          onClick={(e) => {
            e.stopPropagation();
            handleClearParticipatedRange();
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className={isDark ? "space-y-3" : "grid grid-cols-3 gap-4 mb-4"}>
      {participationFilters.length > 0 && (
        <div className={isDark ? "flex justify-end" : "col-span-3 flex justify-end"}>
          <button
            type="button"
            onClick={() => {
              dispatch(clearParticipationFilters());
              dispatch(resetSelectedDateRange());
              onClearAssociation?.();
            }}
            className={`text-[10px] font-medium cursor-pointer ${
              isDark ? "text-white/50 hover:text-white/80" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            Clear all ({participationFilters.length})
          </button>
        </div>
      )}
      {cards.map((card) => {
        const active = participationFilters.includes(card.value);
        const Icon = card.icon;
        return (
          <div key={card.value} className="relative">
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(card.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(card.value);
                }
              }}
              aria-pressed={active}
              className={
                isDark
                  ? `flex w-full flex-col rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                      active
                        ? "bg-brand/20 border-brand-accent/50"
                        : "bg-white/10 border-white/20 hover:bg-white/20"
                    }`
                  : `flex w-full flex-col rounded-sm border px-4 py-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light ${
                      active
                        ? "bg-brand-light border-brand-light shadow-sm"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`
              }
            >
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`size-4 shrink-0 ${
                      isDark ? "text-white/70" : card.iconClass
                    }`}
                  />
                  <span
                    className={
                      isDark
                        ? "text-xs font-medium text-white/80 truncate"
                        : "text-xs font-medium text-slate-600 truncate"
                    }
                  >
                    {card.label}
                  </span>
                </div>
                <span
                  className={
                    isDark
                      ? "text-xl font-bold text-white tabular-nums"
                      : "text-xl font-bold text-slate-800 tabular-nums"
                  }
                >
                  {card.count}
                </span>
              </div>
              {card.value === "participated" && rangeInputs}
            </div>
          </div>
        );
      })}
    </div>
  );
}
