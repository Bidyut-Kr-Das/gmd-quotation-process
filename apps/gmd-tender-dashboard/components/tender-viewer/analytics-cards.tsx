"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { setAnalyticsFilter } from "@/lib/slices/filtersSlice";
import { BarChart3 } from "lucide-react";

interface AnalyticsCardsProps {
  rows: Record<string, string>[];
  associations: { id: number; name: string; email: string }[];
  onAssociationFilterChange?: (val: string | null) => void;
  associationFilter?: string | null;
}

export default function AnalyticsCards({
  rows,
  associations,
  onAssociationFilterChange,
  associationFilter = null,
}: AnalyticsCardsProps) {
  const dispatch = useAppDispatch();
  const analyticsFilter = useAppSelector((s) => s.filters.analyticsFilter);

  const handleCardClick = useCallback(
    (value: "aiYes" | "aiYesUnallocated" | "apmYesAllocated" | "apmYesUnallocated") => {
      dispatch(setAnalyticsFilter(analyticsFilter === value ? null : value));
    },
    [dispatch, analyticsFilter],
  );

  if (!rows || rows.length === 0) return null;

  const aiYes = rows.filter((r) => r.aiRelevanceValid === "true").length;
  const aiYesUnallocated = rows.filter(
    (r) => r.aiRelevanceValid === "true" && !r.assignedTo,
  ).length;
  const apmYesAllocated = rows.filter(
    (r) => r.apm === "YES" && r.assignedTo,
  ).length;
  const apmNoUnallocated = rows.filter(
    (r) => r.apm === "YES" && !r.assignedTo,
  ).length;

  const personCounts = associations
    .map((a) => ({
      ...a,
      count: rows.filter((r) => {
        const assignedIds = (r.assignedTo || "").split(",").filter(Boolean);
        return assignedIds.includes(String(a.id));
      }).length,
    }))
    .filter((p) => p.count > 0);

  const cards: {
    value: "aiYes" | "aiYesUnallocated" | "apmYesAllocated" | "apmYesUnallocated";
    label: string;
    valueNum: number;
    colorClass: string;
  }[] = [
    { value: "aiYes", label: "AI Relevance Yes", valueNum: aiYes, colorClass: "text-primary" },
    { value: "aiYesUnallocated", label: "AI Relevance Yes (Unallocated)", valueNum: aiYesUnallocated, colorClass: "text-primary" },
    { value: "apmYesAllocated", label: "APM Yes (Allocated)", valueNum: apmYesAllocated, colorClass: "text-primary" },
    { value: "apmYesUnallocated", label: "APM Yes (Unallocated)", valueNum: apmNoUnallocated, colorClass: "text-primary" },
  ];

  return (
    <div className="flex flex-col w-96 rounded-sm bg-card border border-border shadow-sm overflow-hidden h-full">
      <div className="bg-muted/60 border-b border-border px-4 py-3 flex items-center gap-2.5">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-card ring-1 ring-border">
          <BarChart3 className="size-3.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Analytics Dashboard
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Key metrics at a glance
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-auto">
        <div className="space-y-1">
          {cards.map((card) => {
            const active = analyticsFilter === card.value;
            return (
              <button
                key={card.value}
                type="button"
                onClick={() => handleCardClick(card.value)}
                className={`w-full flex items-center justify-between py-1.5 px-2.5 rounded-sm text-sm transition-colors cursor-pointer ${
                  active
                    ? "bg-brand-light border border-brand-light shadow-sm"
                    : "bg-muted border border-transparent hover:bg-muted"
                }`}
              >
                <span className="text-foreground">{card.label}</span>
                <span className={`font-semibold ${card.colorClass}`}>
                  {card.valueNum}
                </span>
              </button>
            );
          })}
        </div>

        {personCounts.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Assigned Tenders by Person
            </h4>
            <div className="space-y-1">
              {personCounts.map((p) => {
                const isActive = associationFilter === String(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      onAssociationFilterChange?.(
                        isActive ? null : String(p.id),
                      )
                    }
                    className={`w-full flex items-center justify-between py-1.5 px-2.5 rounded-sm text-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-brand-light border border-brand-light shadow-sm"
                        : "bg-muted border border-transparent hover:bg-muted"
                    }`}
                  >
                    <span className="text-foreground">{p.name}</span>
                    <span className="font-semibold text-primary">{p.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
