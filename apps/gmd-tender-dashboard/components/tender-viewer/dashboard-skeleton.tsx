"use client";

import { Skeleton } from "@/components/ui/skeleton";

const COL_WIDTHS = [44, 130, 110, 150, 100, 120];
const ROW_COUNT = 8;

export default function DashboardSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-13.875rem)] bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-8 w-72 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28 rounded" />
          <Skeleton className="h-8 w-28 rounded" />
          <Skeleton className="h-8 w-24 rounded" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted border-b-2 border-border">
              {COL_WIDTHS.map((w, i) => (
                <th
                  key={i}
                  className="px-3 py-2.5 border-r border-border last:border-r-0"
                  style={{ width: w }}
                >
                  <Skeleton className="h-3 w-full" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-border last:border-b-0"
              >
                {COL_WIDTHS.map((w, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-3 py-2.5 border-r border-border last:border-r-0"
                    style={{ width: w }}
                  >
                    <Skeleton className={`h-4 ${colIdx === 0 ? "w-5" : "w-full"}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 bg-muted border-t border-border">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16 rounded border border-border bg-card" />
        </div>
        <Skeleton className="h-3 w-40" />
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-8 rounded border border-border bg-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
