import React from "react";
import Image from "next/image";
import { Bell } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";
import { ChatPanel } from "@/components/chat/ChatPanel";
import ActiveNavLink from "./ActiveNavLink";

export default async function Navbar() {
  const session = await auth();
  const role = (session?.user as any)?.role as string | undefined;
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background px-6 py-3">
      <div className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.jpg"
              alt="Dalui Logo"
              width={32}
              height={32}
              priority
              className="h-8 w-auto rounded object-contain bg-background p-0.5"
            />
         
          </div>
          <ActiveNavLink href="/">
            Quotation Process
          </ActiveNavLink>
          
          <ActiveNavLink href="/raw_material">
            Raw Material
          </ActiveNavLink>
          <ActiveNavLink href="/supply_history">
            Supply History
          </ActiveNavLink>
          <ActiveNavLink href="/contract_review">
            Contract Review
          </ActiveNavLink>
          <ActiveNavLink href="/indent_listing">
            Indent Checking
          </ActiveNavLink>
          <ActiveNavLink href="/bom">
             FG BOM
          </ActiveNavLink>
          <ActiveNavLink href="/bis-status">
            BIS Status
          </ActiveNavLink>
          <ActiveNavLink href="/upload-image">
            Upload Image
          </ActiveNavLink>
          <Link
            href="http://192.168.1.190:6012/" target="_blank"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0353e9] px-4 text-sm font-semibold text-white hover:bg-[#034ad0] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            GEM BID & RA
          </Link>
          <Link
            href="https://gmd-tender-dashboard.vercel.app/tenders" target="_blank"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0353e9] px-4 text-sm font-semibold text-white hover:bg-[#034ad0] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            Tenders
          </Link>
          <ActiveNavLink href="/data-sources">
            Data Sources
          </ActiveNavLink>
          <ActiveNavLink
            href="/admin/lookup-options"
            className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800"
          >
            Admin
          </ActiveNavLink>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            {session ? (
              <>
                <span className="text-xs font-medium px-2 py-1 rounded bg-muted border text-foreground">
                  {session.user?.email} {role ? `· ${role}` : ""}
                </span>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login" className="inline-flex h-8 items-center px-3 text-sm font-semibold rounded-md border bg-white hover:bg-muted">Login</Link>
                <Link href="/register" className="inline-flex h-8 items-center px-3 text-sm font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Register</Link>
              </>
            )}
            <button className="relative p-1 text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5 stroke-[1.75]" />
              <span className="absolute top-1 right-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            </button>
            <ChatPanel enabled={!!session && (role === "admin" || role === "developer")} />
          </div>

        </div>
      </div>
    </header>
  );
}
