import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function logMetrics(_stage: string, _data: Record<string, unknown>) {
  void _stage; void _data;
}

export async function GET() {
  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = performance.now();
  logMetrics("request_start", { reqId });
  try {
    const tDb = performance.now();
    const files = await prisma.file.findMany({
      where: {
        tenderMergedList: {
          some: {},
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const dbMs = Math.round(performance.now() - tDb);
    const totalMs = Math.round(performance.now() - t0);
    logMetrics("db_complete", { reqId, count: files.length, dbMs, totalMs });
    const res = NextResponse.json({ files });
    res.headers.set("X-Req-Id", reqId);
    res.headers.set("Server-Timing", `db;dur=${dbMs}, total;dur=${totalMs}`);
    logMetrics("response_complete", { reqId, count: files.length, totalMs, status: 200 });
    return res;
  } catch (error) {
    const totalMs = Math.round(performance.now() - t0);
    logMetrics("error", { reqId, error: error instanceof Error ? error.message : String(error), totalMs });
    console.error(
      "Files fetch error:",
      error instanceof Error ? error.message : error,
      error instanceof Error ? error.stack : "",
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
