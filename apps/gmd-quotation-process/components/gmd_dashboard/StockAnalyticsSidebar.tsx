"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@gmd/ui/components/card";
import { ChevronsLeft, ChevronsRight, Hash, IndianRupee } from "lucide-react";

export type StockCardKind = "qty" | "value";
export type MajorMinorKind = "yes" | "no" | "blank";

const MAJOR_MINOR_OPTIONS: { kind: MajorMinorKind; label: string }[] = [
  { kind: "yes", label: "Major" },
  { kind: "no", label: "Minor" },
  { kind: "blank", label: "Blank" },
];

interface StockAnalyticsSidebarProps {
  availableQty: number;
  availableValue: number;
  collapsed: boolean;
  onToggle: () => void;
  activeCard: StockCardKind | null;
  onCardClick: (kind: StockCardKind) => void;
  majorMinorSelection: Set<MajorMinorKind>;
  majorMinorCounts: Record<MajorMinorKind, number>;
  onToggleMajorMinor: (kind: MajorMinorKind) => void;
}

function formatQty(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatValue(n: number): string {
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export default function StockAnalyticsSidebar({
  availableQty,
  availableValue,
  collapsed,
  onToggle,
  activeCard,
  onCardClick,
  majorMinorSelection,
  majorMinorCounts,
  onToggleMajorMinor,
}: StockAnalyticsSidebarProps) {
  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col items-start pt-0.5">
        <button
          type="button"
          onClick={onToggle}
          title="Expand analytics"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted text-muted-foreground transition-colors"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  const cardClass = (active: boolean) =>
    `shadow-sm transition-all cursor-pointer select-none ${
      active
        ? "ring-2 ring-[#0f62fe] bg-muted/40"
        : "hover:ring-foreground/20 hover:bg-muted/20"
    }`;

  return (
    <aside className="shrink-0 w-72 flex flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">
          Stock Analytics
        </h2>
        <button
          type="button"
          onClick={onToggle}
          title="Collapse analytics"
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      <Card
        size="sm"
        role="button"
        tabIndex={0}
        aria-pressed={activeCard === "qty"}
        onClick={() => onCardClick("qty")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCardClick("qty");
          }
        }}
        className={cardClass(activeCard === "qty")}
      >
        <CardHeader className="pb-1">
          <CardTitle className="text-[12px] font-semibold flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5 text-teal-600 dark:text-teal-300" />
            Available Stock Qty
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-xl font-bold tracking-tight text-foreground">
            {formatQty(availableQty)}
          </span>
        </CardContent>
      </Card>

      <Card
        size="sm"
        role="button"
        tabIndex={0}
        aria-pressed={activeCard === "value"}
        onClick={() => onCardClick("value")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCardClick("value");
          }
        }}
        className={cardClass(activeCard === "value")}
      >
        <CardHeader className="pb-1">
          <CardTitle className="text-[12px] font-semibold flex items-center gap-1.5">
            <IndianRupee className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
            Available Stock Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-xl font-bold tracking-tight text-foreground">
            ₹ {formatValue(availableValue)}
          </span>
        </CardContent>
      </Card>

      <Card size="sm" className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">
            Major / Minor Marking
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-1.5">
          {MAJOR_MINOR_OPTIONS.map(({ kind, label }) => {
            const active = majorMinorSelection.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onToggleMajorMinor(kind)}
                aria-pressed={active}
                className={`flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-[11px] transition-all cursor-pointer ${
                  active
                    ? "border-[#0f62fe] bg-blue-50 text-[#0f62fe] font-semibold dark:bg-blue-500/10 dark:border-blue-500 dark:text-blue-300"
                    : "border-border bg-background text-foreground hover:bg-muted/60"
                }`}
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    active
                      ? "bg-blue-200 text-blue-900 dark:bg-blue-500/25 dark:text-blue-200"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {majorMinorCounts[kind]}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </aside>
  );
}
