"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { ArrowUpRight, Check, ChevronDown, KeyRound, LogIn, LogOut, Menu, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnderChangesBanner } from "@/components/UnderChangesBanner";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV, isActive, isGroup, type NavLink } from "@/components/layout/nav-items";

const TAB =
  "relative inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] data-popup-open:bg-muted data-popup-open:text-foreground";
const TAB_ACTIVE =
  "text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-primary";

const linkProps = (l: NavLink) => (l.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

export function NavBar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = NAV.filter((e) => !e.roles || (role && e.roles.includes(role)));

  return (
    <>
      <UnderChangesBanner />
      <header className="sticky top-0 z-40 w-full shrink-0 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 lg:gap-5">
            <Link
              href="/tenders"
              className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Image
                src="/header-final-logo.png"
                alt="G M Dalui"
                width={150}
                height={83}
                priority
                className="h-8 w-auto rounded bg-background object-contain p-0.5"
              />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
              {nav.map((entry) => {
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

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="Open navigation"
                className="order-first inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="gap-0 overflow-y-auto p-4">
                <SheetTitle className="mb-3 px-2">Navigation</SheetTitle>
                <nav aria-label="Main" className="flex flex-col gap-4">
                  {nav.map((entry) => {
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
                              onClick={() => setMobileOpen(false)}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted",
                                active ? "bg-muted font-semibold text-foreground" : "text-foreground/80",
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
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            {status === "loading" ? (
              <div className="ml-1.5 size-8 animate-pulse rounded-lg bg-muted" />
            ) : session?.user ? (
              <div className="ml-1.5 border-l border-border pl-3">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Account menu"
                    className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground transition-transform duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95"
                  >
                    {initials(session.user.name, session.user.email)}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8} className="w-auto min-w-56 p-1.5">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2 py-1.5">
                        <div className="truncate text-sm font-medium text-foreground">
                          {session.user.name || session.user.email}
                        </div>
                        {session.user.name && (
                          <div className="truncate text-xs text-muted-foreground">{session.user.email}</div>
                        )}
                        {role && <div className="mt-1 text-xs capitalize text-muted-foreground">{role}</div>}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowChangePassword(true)} className="cursor-pointer px-2 py-1.5">
                      <KeyRound /> Change password
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => signOut()} className="cursor-pointer px-2 py-1.5">
                      <LogOut /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="ml-1.5 flex items-center gap-1.5 border-l border-border pl-3">
                <Link
                  href="/auth/signup"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <UserPlus className="size-4" />
                  Sign up
                </Link>
                <button
                  type="button"
                  onClick={() => signIn()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 active:translate-y-px"
                >
                  <LogIn className="size-4" />
                  Sign in
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <ChangePasswordDialog open={showChangePassword} onOpenChange={setShowChangePassword} />
    </>
  );
}

function initials(name?: string | null, email?: string | null) {
  return (name || email || "U")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
