import { auth } from "@/auth"

export async function getCurrentUser() {
  const session = await auth()
  return session?.user ?? null
}

export async function requireAdminOrDeveloper() {
  const session = await auth()
  const role = (session?.user as any)?.role
  if (!session || !["admin", "developer"].includes(role)) {
    throw new Error("Unauthorized: admin or developer only")
  }
  return session
}

export function canEditApm(role?: string | null) {
  return role === "admin" || role === "developer"
}

export function isDeveloper(role?: string | null) {
  return role === "developer"
}

export async function requireDeveloper() {
  const session = await auth()
  const role = (session?.user as any)?.role
  if (!session || role !== "developer") {
    throw new Error("Unauthorized: developer only")
  }
  return session
}
