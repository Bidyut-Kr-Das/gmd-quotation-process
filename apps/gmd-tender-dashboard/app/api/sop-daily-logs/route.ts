import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseIstDateToUTC(dateStr: string): Date | null {
  const s = String(dateStr).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(Date.UTC(y, m, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

async function getLogs(params: { date?: string; from?: string; to?: string; sopId?: string }) {
  if (params.date) {
    const d = parseIstDateToUTC(params.date);
    if (!d) throw Object.assign(new Error("Invalid date"), { status: 400 });
    const rows = await prisma.sopDailyLog.findMany({ where: { date: d }, orderBy: { sopResponsibilityId: "asc" } });
    return rows;
  }
  if (params.from || params.to) {
    const where: any = {};
    if (params.sopId) where.sopResponsibilityId = parseInt(params.sopId, 10);
    if (params.from) {
      const f = parseIstDateToUTC(params.from);
      if (!f) throw Object.assign(new Error("Invalid from"), { status: 400 });
      where.date = { ...(where.date || {}), gte: f };
    }
    if (params.to) {
      const t = parseIstDateToUTC(params.to);
      if (!t) throw Object.assign(new Error("Invalid to"), { status: 400 });
      where.date = { ...(where.date || {}), lte: t };
    }
    const rows = await prisma.sopDailyLog.findMany({ where, orderBy: [{ date: "asc" }, { sopResponsibilityId: "asc" }] });
    return rows;
  }
  // default: recent 30 days? return empty if no filter to avoid big dump
  const rows = await prisma.sopDailyLog.findMany({ orderBy: { date: "desc" }, take: 500 });
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date") || undefined;
    const from = req.nextUrl.searchParams.get("from") || undefined;
    const to = req.nextUrl.searchParams.get("to") || undefined;
    const sopId = req.nextUrl.searchParams.get("sopId") || undefined;
    const rows = await getLogs({ date, from, to, sopId });
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
