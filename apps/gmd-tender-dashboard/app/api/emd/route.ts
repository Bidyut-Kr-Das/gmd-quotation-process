import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function getEmdMerged() {
  const rows = await prisma.emdMerged.findMany({
    orderBy: { createdAt: "desc" },
    include: { tenderMergeds: { select: { id: true, docketNo: true } } },
  });
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const emdType = url.searchParams.get("emdType");
    if (emdType && (emdType === "CASH" || emdType === "BG")) {
      const rows = await prisma.emdMerged.findMany({
        where: { emdType: emdType as any },
        orderBy: { createdAt: "desc" },
        include: { tenderMergeds: { select: { id: true, docketNo: true } } },
      });
      return NextResponse.json({ success: true, data: rows });
    }
    const rows = await getEmdMerged();
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[API:GET /api/emd] failed:", err.message);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
