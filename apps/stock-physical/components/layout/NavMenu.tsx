"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@gmd/ui/lib/utils";

const TAB =
  "relative inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]";
const TAB_ACTIVE =
  "text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-primary";

const NAV = [{ label: "Physical Stock", href: "/" }];

export default function NavMenu() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex items-center gap-0.5">
      {NAV.map((entry) => {
        const active = pathname === entry.href;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active && TAB_ACTIVE)}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
