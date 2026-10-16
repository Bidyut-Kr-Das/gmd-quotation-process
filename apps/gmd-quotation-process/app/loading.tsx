import React from "react";
import { Skeleton } from "@gmd/ui/components/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1 flex flex-col p-6 w-full gap-4 mx-auto">
        {/* Header Toolbar Skeleton */}
        <div className="flex flex-col gap-4 py-5 px-6 bg-card sm:flex-row sm:items-center sm:justify-between border border-border rounded-lg shadow-sm">
          <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
            <Skeleton className="h-7 w-48 bg-muted" />
            <Skeleton className="h-9 w-64 bg-muted rounded-md" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-9 w-28 bg-muted rounded-md" />
            <Skeleton className="h-9 w-28 bg-muted rounded-md" />
            <Skeleton className="h-9 w-32 bg-muted rounded-md" />
          </div>
        </div>

        {/* Table Body Skeleton */}
        <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm flex flex-col">
          <div className="p-4 border-b border-border bg-muted/50">
            <Skeleton className="h-5 w-full bg-muted" />
          </div>
          <div className="p-6 space-y-4">
            {Array.from({ length: 10 }).map((_, idx) => (
              <Skeleton key={idx} className="h-12 w-full bg-muted/60" />
            ))}
          </div>
          {/* Footer Pagination Skeleton */}
          <div className="p-4 border-t border-border bg-muted/50 flex justify-between items-center">
            <Skeleton className="h-4 w-48 bg-muted" />
            <Skeleton className="h-8 w-64 bg-muted rounded-md" />
          </div>
        </div>
      </main>
    </div>
  );
}
