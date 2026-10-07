import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const rows = await prisma.emdDetailsCash.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[API:GET /api/emd-details-cash] failed:", err.message);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
