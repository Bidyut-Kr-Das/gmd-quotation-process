import Skeleton from "../Skeleton";

export default function GMDUpdateSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className="bg-muted">
            <tr>
              {Array.from({ length: 8 }).map((_, i) => (
                <th key={i} className="px-3 py-2.5 border-b-2 border-border border-r border-border last:border-r-0">
                  <Skeleton className="h-3 w-20 bg-accent" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="animate-pulse">
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="px-3 py-2.5 border-b border-border border-r border-border last:border-r-0">
                    <Skeleton className="h-4 w-5/6 bg-muted" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-muted border-t border-border px-4 py-2.5 flex items-center justify-between">
        <Skeleton className="h-4 w-44 bg-accent" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-14 rounded bg-accent" />
          <Skeleton className="h-7 w-12 rounded bg-accent" />
          <Skeleton className="h-7 w-8 rounded bg-accent" />
          <Skeleton className="h-7 w-8 rounded bg-accent" />
          <Skeleton className="h-7 w-8 rounded bg-accent" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-7 w-12 rounded bg-accent" />
          <Skeleton className="h-7 w-14 rounded bg-accent" />
        </div>
      </div>
    </div>
  );
}
