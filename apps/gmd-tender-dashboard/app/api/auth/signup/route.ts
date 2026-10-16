import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await prisma.user.create({
      data: {
        name: name || null,
        email,
        passwordHash,
        role: "user",
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
