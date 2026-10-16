import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * The bar at the top of every page: what you are looking at, how much of it,
 * and what you can do to it.
 *
 * Replaces three near-identical CSS classes that had drifted apart —
 * `.dashboard-top-header` (3 pages), `.supply-top-header` (5 pages) and
 * `.tender-top-header` (1 page).
 *
 * `subtitle` is the place for record counts and the active filter summary;
 * it sits after a divider so the page name stays scannable.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <h1 className="truncate text-base font-bold tracking-wide text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <>
            <Separator orientation="vertical" className="h-5.5 self-center" />
            <p className="truncate text-xs font-medium text-muted-foreground">
              {subtitle}
            </p>
          </>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
