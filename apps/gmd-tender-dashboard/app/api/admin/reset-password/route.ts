import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { withLog } from "@/lib/activity-logger"
import { requireApiKey } from "@/lib/dal"

export const runtime = "nodejs"

const DEFAULT_PASSWORD = "Laser@1234"

async function resetPassword(email: string) {
  const normalizedEmail = email.trim().toLowerCase()

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  })

  if (!user) {
    throw new Error("User not found")
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  })

  return { email: user.email, userId: user.id }
}

const resetPasswordWithLog = withLog(resetPassword, (result) => ({
  action: "UPDATE" as const,
  tableName: "User",
  recordId: result.userId,
  details: `Admin reset password for ${result.email} to default via API key`,
}))

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req)
  if (forbidden) return forbidden

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const email = (body as { email?: unknown })?.email

  if (!email || typeof email !== "string" || email.trim().length === 0) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 })
  }

  try {
    const result = await resetPasswordWithLog(email)
    return NextResponse.json({ success: true, email: result.email })
  } catch (err) {
    const message = (err as Error).message
    if (message === "User not found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    console.error("[reset-password] error:", err)
    return NextResponse.json({ error: message || "Something went wrong" }, { status: 500 })
  }
}
