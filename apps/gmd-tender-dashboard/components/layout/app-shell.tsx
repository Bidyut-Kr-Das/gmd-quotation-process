import { cn } from "@/lib/utils";

/**
 * The region below the fixed NavBar.
 *
 * Replaces a hardcoded `paddingTop: "42px"` inline style in the root layout
 * that silently coupled the layout to NavBar's height. The offset now comes
 * from `--nav-h`, the same token NavBar sizes itself with, so the two can
 * never drift apart.
 *
 * Geometry is deliberately identical to what it replaced (100vh tall, offset
 * by the nav height) because pages currently size themselves with
 * `calc(100vh - 42px)`. Those calls get replaced page by page.
 */
export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-screen flex-col pt-(--nav-h)", className)}>
      {children}
    </div>
  );
}
