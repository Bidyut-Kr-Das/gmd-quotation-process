"use client";

import { Skeleton } from "@/components/ui/skeleton";

const COL_WIDTHS = [44, 130, 110, 150, 100, 120];
const ROW_COUNT = 8;

export default function DashboardSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] bg-white border border-[#e1e6eb] rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-brand gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Skeleton className="h-4 w-48 bg-white/15" />
          <Skeleton className="h-5 w-20 rounded-full bg-white/15" />
          <Skeleton className="h-8 w-72 rounded bg-white/15" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28 rounded bg-white/15" />
          <Skeleton className="h-8 w-28 rounded bg-white/15" />
          <Skeleton className="h-8 w-24 rounded bg-white/15" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f4f6f8] border-b-2 border-[#e1e6eb]">
              {COL_WIDTHS.map((w, i) => (
                <th
                  key={i}
                  className="px-3 py-2.5 border-r border-[#e1e6eb] last:border-r-0"
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
                className="border-b border-[#e1e6eb] last:border-b-0"
              >
                {COL_WIDTHS.map((w, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-3 py-2.5 border-r border-[#e1e6eb] last:border-r-0"
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

      <div className="flex items-center justify-between px-4 py-2.5 bg-[#f4f6f8] border-t border-[#e1e6eb]">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16 rounded border border-[#e1e6eb] bg-white" />
        </div>
        <Skeleton className="h-3 w-40" />
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-8 rounded border border-[#e1e6eb] bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}
