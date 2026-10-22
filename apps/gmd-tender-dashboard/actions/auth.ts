"use server"

import { signIn, auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { withLog } from "@/lib/activity-logger"

export type AuthState = { ok: true; url: string } | { ok: false; message: string }

export async function authenticate(
  _prev: AuthState | undefined,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const redirectTo = formData.get("redirectTo") as string

  if (!email || !password) {
    return { ok: false, message: "Email and password are required" }
  }

  // Fail fast with a clear cause instead of a cryptic pg connection error.
  if (!process.env.TENDER_DATABASE_URL) {
    console.error("[authenticate] TENDER_DATABASE_URL is not set")
    return { ok: false, message: "Sign-in unavailable: server is not configured." }
  }

  try {
    const url = await signIn("credentials", {
      email,
      password,
      redirectTo,
      redirect: false,
    })

    if (typeof url !== "string") {
      return { ok: false, message: "Something went wrong" }
    }

    return { ok: true, url }
  } catch (error) {
    // With redirect:false, Auth.js throws instead of returning an error URL:
    // CredentialsSignin = null from authorize (bad email/password).
    // CallbackRouteError = authorize threw (e.g. DB down); its cause holds the real reason.
    const { type, cause } = error as { type?: string; cause?: unknown }
    if (type === "CredentialsSignin") {
      return { ok: false, message: "Invalid email or password" }
    }
    console.error("[authenticate] sign-in failed:", error, cause)
    return {
      ok: false,
      message: "Sign-in failed due to a server error. Try again or contact admin.",
    }
  }
}

export const changePassword = withLog(
  async (params: { oldPassword: string; newPassword: string }) => {
    const session = await auth()
    if (!session?.user?.id) {
      throw new Error("Unauthorized: Please sign in again")
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    })

    if (!user) {
      throw new Error("User not found")
    }

    if (!user.passwordHash) {
      throw new Error("No password set for this account")
    }

    const isValid = await bcrypt.compare(params.oldPassword, user.passwordHash)
    if (!isValid) {
      throw new Error("Incorrect old password")
    }

    if (!params.newPassword || params.newPassword.length === 0) {
      throw new Error("New password is required")
    }

    const passwordHash = await bcrypt.hash(params.newPassword, 10)

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    return { success: true, userId: user.id }
  },
  (result) => ({
    action: "UPDATE" as const,
    tableName: "User",
    recordId: result.userId,
    details: "User changed password",
  })
)
