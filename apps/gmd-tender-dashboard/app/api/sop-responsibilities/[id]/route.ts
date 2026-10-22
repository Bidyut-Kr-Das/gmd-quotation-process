import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { auth } from "@/auth";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function parseIstDateToUTC(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
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

const ALLOWED_SOURCES = new Set(["MANUAL","UPLOAD_EXCEL","SCRAPE_247","AI","DOCUMENT_PARSE","RA_AUTOMATION","GOOGLE_SHEET_SYNC","SYSTEM"]);
const AUTO_FALSE_SOURCES = new Set(["AI","DOCUMENT_PARSE","RA_AUTOMATION","SCRAPE_247"]);

async function updateSop(id: number, body: any) {
  const data: Record<string, any> = {};
  if (body.columnName !== undefined) {
    const v = String(body.columnName).trim();
    if (!v) throw Object.assign(new Error("columnName cannot be empty"), { status: 400 });
    if (v.length > 200) throw Object.assign(new Error("columnName too long"), { status: 400 });
    data.columnName = v;
  }
  if (body.description !== undefined) data.description = body.description?.trim() ? String(body.description).trim() : null;
  if (body.allocatedTo !== undefined) data.allocatedTo = body.allocatedTo?.trim() ? String(body.allocatedTo).trim() : null;
  if (body.email !== undefined) {
    const e = body.email?.trim() ? String(body.email).trim() : null;
    if (e && !isValidEmail(e)) throw Object.assign(new Error(`Invalid email: ${e}`), { status: 400 });
    data.email = e;
  }
  if (body.dailyLog !== undefined) data.dailyLog = body.dailyLog?.trim() ? String(body.dailyLog).trim() : null;
  if (body.date !== undefined) {
    if (body.date === null || String(body.date).trim() === "") data.date = null;
    else {
      const dv = parseIstDateToUTC(String(body.date));
      if (!dv) throw Object.assign(new Error("Invalid date"), { status: 400 });
      data.date = dv;
    }
  }
  if (body.source !== undefined) {
    const s = body.source?.trim() ? String(body.source).trim().toUpperCase() : null;
    if (s && !ALLOWED_SOURCES.has(s)) throw Object.assign(new Error(`Invalid source: ${s}`), { status: 400 });
    data.source = s;
    if (s && AUTO_FALSE_SOURCES.has(s)) {
      if (body.dailyLogEnabled === undefined) data.dailyLogEnabled = false;
      if (body.dateEnabled === undefined) data.dateEnabled = false;
    }
  }
  if (body.doneFromWhere !== undefined) data.doneFromWhere = body.doneFromWhere?.trim() ? String(body.doneFromWhere).trim() : null;
  if (body.isManual !== undefined) data.isManual = Boolean(body.isManual);
  if (body.dailyLogEnabled !== undefined) data.dailyLogEnabled = Boolean(body.dailyLogEnabled);
  if (body.dateEnabled !== undefined) data.dateEnabled = Boolean(body.dateEnabled);
  if (Object.keys(data).length === 0) throw Object.assign(new Error("No fields to update"), { status: 400 });
  const updated = await prisma.sopResponsibility.update({ where: { id }, data });
  return updated;
}
const updateSopWithLog = withLog(updateSop, (result, id) => ({
  action: "UPDATE" as const,
  tableName: "SopResponsibility",
  recordId: String(result.id),
  details: `Updated SOP #${result.id} "${result.columnName}"`,
}));

async function deleteSop(id: number) {
  const deleted = await prisma.sopResponsibility.delete({ where: { id } });
  return deleted;
}
const deleteSopWithLog = withLog(deleteSop, (result, id) => ({
  action: "DELETE" as const,
  tableName: "SopResponsibility",
  recordId: String(id),
  details: `Deleted SOP #${id} "${result.columnName}"`,
}));

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes(session.user.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
    const body = await req.json();
    const result = await updateSopWithLog(numId, body);
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    if (err.code === "P2025") return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes(session.user.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
    await deleteSopWithLog(numId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.code === "P2025") return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
