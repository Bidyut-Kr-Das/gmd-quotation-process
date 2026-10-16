import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    // Lightweight query to verify database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },

      { status: 200, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        database: "down",
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Database unreachable",
      },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }
}

// HEAD is often used by load balancers / uptime monitors
export async function HEAD() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
