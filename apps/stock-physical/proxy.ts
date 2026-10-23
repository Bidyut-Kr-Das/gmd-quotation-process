import { auth } from "@/auth"
import { NextResponse } from "next/server"

export const proxy = auth((req) => {
  if (req.auth) return
  const url = new URL("/login", req.nextUrl)
  url.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(url)
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|register).*)"],
}
