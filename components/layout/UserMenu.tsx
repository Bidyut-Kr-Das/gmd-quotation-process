"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, Settings2 } from "lucide-react";
import { clearDraft } from "@/lib/newEnquiryDraft";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email, name, role }: { email: string; name?: string | null; role?: string }) {
  const router = useRouter();
  const initials = (name || email).slice(0, 2).toUpperCase();

  const logout = async () => {
    // No redirect, stay on same page — just clear JWT cookie
    clearDraft(); // don't hand this user's unsaved New Enquiry draft to the next user
    await signOut({ redirect: false });
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground transition-transform duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-auto min-w-56 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <div className="truncate text-sm font-medium text-foreground">{name || email}</div>
            {name && <div className="truncate text-xs text-muted-foreground">{email}</div>}
            {role && <div className="mt-1 text-xs capitalize text-muted-foreground">{role}</div>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {role === "developer" && (
          <DropdownMenuItem render={<Link href="/admin/lookup-options" />} className="cursor-pointer px-2 py-1.5">
            <Settings2 /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={logout} className="cursor-pointer px-2 py-1.5">
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
