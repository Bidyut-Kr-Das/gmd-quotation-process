import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function getEmdDetailsBg() {
  const rows = await prisma.emdDetailsBG.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const rows = await getEmdDetailsBg();
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[API:GET /api/emd-details-bg] failed:", err.message);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
