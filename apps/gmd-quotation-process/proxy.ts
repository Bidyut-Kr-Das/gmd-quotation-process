import { auth } from "@/auth"

export const proxy = auth((req) => {
  // Intentionally public — real gating is per Server Action / UI (APM & Offer PDF)
  // req.auth is populated for downstream use if needed
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
