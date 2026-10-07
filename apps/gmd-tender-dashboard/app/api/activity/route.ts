import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)))
    const userFilter = searchParams.get("user")
    const tableFilter = searchParams.get("table")
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const where: Record<string, unknown> = {}
    if (userFilter) {
      where.OR = [
        { userName: { contains: userFilter, mode: "insensitive" } },
        { userEmail: { contains: userFilter, mode: "insensitive" } },
        { referenceNo: { contains: userFilter, mode: "insensitive" } },
      ]
    }
    if (tableFilter) {
      where.tableName = { equals: tableFilter, mode: "insensitive" }
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {}
      if (from) createdAt.gte = new Date(from)
      if (to) createdAt.lte = new Date(to)
      where.createdAt = createdAt
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.activityLog.count({ where }),
    ])

    return NextResponse.json({ logs, total, page, pageSize })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}
