import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import NavMenu from "./NavMenu";
import { NewItemButton } from "./NewItemButton";
import { UserMenu } from "./UserMenu";

export default async function Navbar() {
  const session = await auth();
  const role = (session?.user as any)?.role as string | undefined;
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 lg:gap-5">
          <Link href="/" className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Image
              src="/logo.jpg"
              alt="GMD Logo"
              width={32}
              height={32}
              priority
              className="h-8 w-auto rounded bg-background object-contain p-0.5"
            />
          </Link>
          <NavMenu />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {session?.user?.email ? (
            <>
              <NewItemButton />
              <div className="ml-1.5 border-l border-border pl-3">
                <UserMenu email={session.user.email} name={session.user.name} role={role} />
              </div>
            </>
          ) : (
            <div className="ml-1.5 flex items-center gap-1.5 border-l border-border pl-3">
              <Link href="/login" className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                Login
              </Link>
              <Link href="/register" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
