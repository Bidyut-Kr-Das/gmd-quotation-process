const statusColorMap: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  INACTIVE: "bg-muted text-muted-foreground",
  NEW: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  REVIEW: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
};

export default function GMDUpdateStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value || value.trim() === "") {
    return <span className="text-muted-foreground text-body-sm">—</span>;
  }

  const upper = value.toUpperCase().trim();
  const colorClass = statusColorMap[upper] ?? "bg-muted text-muted-foreground";

  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-tighter ${colorClass}`}>
      {upper}
    </span>
  );
}
