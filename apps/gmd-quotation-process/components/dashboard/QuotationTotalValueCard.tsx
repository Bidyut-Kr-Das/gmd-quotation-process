"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@gmd/ui/components/card";
import { Hash, IndianRupee, Percent } from "lucide-react";

interface QuotationTotalValueCardProps {
  formattedSum: string;
  formattedExclSum: string;
  formattedTotalCost: string;
  formattedTotalVa: string;
  formattedTotalQuantity: string;
  filteredEnquiriesCount: number;
  analyticsItemsCount: number;
  hasActiveAnalyticsFilters: boolean;
  activeFilterCount: number;
  className?: string;
}

export default function QuotationTotalValueCard({
  formattedSum,
  formattedExclSum,
  formattedTotalCost,
  formattedTotalVa,
  formattedTotalQuantity,
  filteredEnquiriesCount,
  analyticsItemsCount,
  hasActiveAnalyticsFilters,
  activeFilterCount,
  className,
}: QuotationTotalValueCardProps) {
  const cardClassName =
    "shadow-sm bg-linear-to-br from-muted/50 to-card border-border shrink-0 w-full sm:w-72 py-1";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
    >
      {/* 1. Total Value (incl. GST) */}
      <Card size="sm" className={cardClassName}>
        <CardHeader className="py-1 pb-0.5">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
            <IndianRupee className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
            Total Value (incl. GST)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-row items-center gap-1.5 py-0.5">
          <span className="text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">
            ₹ {formattedSum}
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground whitespace-nowrap">
            {filteredEnquiriesCount} dockets
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground whitespace-nowrap">
            {analyticsItemsCount} items
          </span>
          {hasActiveAnalyticsFilters && (
            <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 text-[9.5px] font-medium whitespace-nowrap">
              {activeFilterCount} filters
            </span>
          )}
        </CardContent>
      </Card>

      {/* 2. Total Value (excl. GST) */}
      <Card size="sm" className={cardClassName}>
        <CardHeader className="py-1 pb-0.5">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
            <IndianRupee className="h-3 w-3 text-muted-foreground" />
            Total Value (excl. GST)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-row items-center gap-2 py-0.5">
          <span className="text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">
            ₹ {formattedExclSum}
          </span>
        </CardContent>
      </Card>

      {/* 3. Total Cost */}
      <Card size="sm" className={cardClassName}>
        <CardHeader className="py-1 pb-0.5">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
            <IndianRupee className="h-3 w-3 text-amber-600 dark:text-amber-300" />
            Total Cost
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-row items-center gap-2 py-0.5">
          <span className="text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">
            ₹ {formattedTotalCost}
          </span>
        </CardContent>
      </Card>

      {/* 4. Total VA% */}
      <Card size="sm" className={cardClassName}>
        <CardHeader className="py-1 pb-0.5">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
            <Percent className="h-3 w-3 text-indigo-600 dark:text-indigo-300" />
            Total VA%
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-row items-center gap-2 py-0.5">
          <span className="text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">
            {formattedTotalVa}
          </span>
        </CardContent>
      </Card>

      {/* 5. Total Quantity */}
      <Card size="sm" className={cardClassName}>
        <CardHeader className="py-1 pb-0.5">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
            <Hash className="h-3 w-3 text-teal-600 dark:text-teal-300" />
            Total Quantity
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-row items-center gap-2 py-0.5">
          <span className="text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">
            {formattedTotalQuantity}
          </span>
        </CardContent>
      </Card>

      {/* <div className="hidden xl:flex items-center text-[10px] text-muted-foreground italic ml-auto pr-2">
        {!hasActiveAnalyticsFilters ? (
          <span>All dockets — apply filters to narrow.</span>
        ) : analyticsItemsCount === 0 ? (
          <span className="text-amber-600 dark:text-amber-300">No items match.</span>
        ) : null}
      </div> */}
    </div>
  );
}
