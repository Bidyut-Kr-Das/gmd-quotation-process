"use server"

import { signIn, auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { withLog } from "@/lib/activity-logger"

export async function authenticate(_prev: string | undefined, formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const redirectTo = formData.get("redirectTo") as string

  try {
    const url = await signIn("credentials", {
      email,
      password,
      redirectTo,
      redirect: false,
    })

    if (typeof url === "string" && url.includes("error")) {
      return "Invalid email or password"
    }

    return url
  } catch (error) {
    return "Something went wrong"
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
