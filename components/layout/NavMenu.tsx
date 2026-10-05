"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV, isActive, isGroup, type NavLink } from "./nav-items";

const TAB =
  "relative inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] data-popup-open:bg-muted data-popup-open:text-foreground";
const TAB_ACTIVE =
  "text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-primary";

const linkProps = (l: NavLink) => (l.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

export default function NavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
        {NAV.map((entry) => {
          if (!isGroup(entry)) {
            const active = isActive(pathname, entry.href);
            return (
              <Link
                key={entry.label}
                href={entry.href}
                {...linkProps(entry)}
                aria-current={active ? "page" : undefined}
                className={cn(TAB, active && TAB_ACTIVE)}
              >
                {entry.label}
              </Link>
            );
          }
          const groupActive = entry.items.some((i) => !i.external && isActive(pathname, i.href));
          return (
            <DropdownMenu key={entry.label}>
              <DropdownMenuTrigger className={cn(TAB, groupActive && TAB_ACTIVE)}>
                {entry.label}
                <ChevronDown className="size-3.5 opacity-60 transition-transform duration-200 [[data-popup-open]>&]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto min-w-48 p-1.5" sideOffset={10}>
                {entry.items.map((item) => {
                  const active = !item.external && isActive(pathname, item.href);
                  return (
                    <DropdownMenuItem
                      key={item.href}
                      render={<Link href={item.href} {...linkProps(item)} />}
                      className={cn("cursor-pointer justify-between gap-6 px-2 py-1.5", active && "font-semibold")}
                    >
                      {item.label}
                      {item.external ? (
                        <ArrowUpRight className="text-muted-foreground" />
                      ) : (
                        active && <Check className="text-primary" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open navigation"
          className="order-first inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="gap-0 overflow-y-auto p-4">
          <SheetTitle className="mb-3 px-2">Navigation</SheetTitle>
          <nav aria-label="Main" className="flex flex-col gap-4">
            {NAV.map((entry) => {
              const items = isGroup(entry) ? entry.items : [entry];
              return (
                <div key={entry.label} className="flex flex-col">
                  {isGroup(entry) && (
                    <span className="px-2 pb-1 text-xs font-medium text-muted-foreground">{entry.label}</span>
                  )}
                  {items.map((item) => {
                    const active = !item.external && isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        {...linkProps(item)}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted",
                          active ? "bg-muted font-semibold text-foreground" : "text-foreground/80"
                        )}
                      >
                        {item.label}
                        {item.external && <ArrowUpRight className="size-4 text-muted-foreground" />}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
