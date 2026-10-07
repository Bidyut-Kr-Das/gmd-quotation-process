import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcrypt"
import { z } from "zod"

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 })
    }
    const { name, email, password } = parsed.data
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 })
    const hash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({ data: { name: name || null, email, password: hash, role: "user" } })
    return NextResponse.json({ success: true, id: user.id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Registration failed" }, { status: 500 })
  }
}
