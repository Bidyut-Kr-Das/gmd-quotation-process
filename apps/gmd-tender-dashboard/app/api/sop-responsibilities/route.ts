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
  // Accept YYYY-MM-DD
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Force IST midnight -> store as UTC date with IST offset
  // Simpler: parse YYYY-MM-DD and construct UTC date at IST 00:00
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    // IST is UTC+5:30, so UTC time = IST 00:00 - 5:30
    return new Date(Date.UTC(y, m, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  }
  return d;
}

async function getAllSop() {
  const rows = await prisma.sopResponsibility.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows;
}

export async function GET() {
  try {
    const rows = await getAllSop();
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}

const ALLOWED_SOURCES = new Set(["MANUAL","UPLOAD_EXCEL","SCRAPE_247","AI","DOCUMENT_PARSE","RA_AUTOMATION","GOOGLE_SHEET_SYNC","SYSTEM"]);
const AUTO_FALSE_SOURCES = new Set(["AI","DOCUMENT_PARSE","RA_AUTOMATION","SCRAPE_247"]);

async function createSop(payload: {
  columnName: string;
  description?: string | null;
  allocatedTo?: string | null;
  email?: string | null;
  dailyLog?: string | null;
  date?: string | null;
  source?: string | null;
  doneFromWhere?: string | null;
  isManual?: boolean | null;
  dailyLogEnabled?: boolean | null;
  dateEnabled?: boolean | null;
}) {
  const columnName = String(payload.columnName ?? "").trim();
  if (!columnName) throw Object.assign(new Error("columnName is required"), { status: 400 });
  if (columnName.length > 200) throw Object.assign(new Error("columnName too long (max 200)"), { status: 400 });
  if (payload.email) {
    const e = String(payload.email).trim();
    if (e && !isValidEmail(e)) throw Object.assign(new Error(`Invalid email: ${e}`), { status: 400 });
  }
  const dateVal = parseIstDateToUTC(payload.date ?? null);
  if (payload.date && !dateVal) throw Object.assign(new Error("Invalid date, expected YYYY-MM-DD"), { status: 400 });

  let source: string | null = payload.source?.trim() ? String(payload.source).trim().toUpperCase() : null;
  if (source && !ALLOWED_SOURCES.has(source)) throw Object.assign(new Error(`Invalid source: ${source}`), { status: 400 });
  let dailyLogEnabled: boolean | null = payload.dailyLogEnabled ?? null;
  let dateEnabled: boolean | null = payload.dateEnabled ?? null;
  // Default dailyLog/date false for AI/parsing automation when source indicates auto
  if (source && AUTO_FALSE_SOURCES.has(source)) {
    if (dailyLogEnabled === null) dailyLogEnabled = false;
    if (dateEnabled === null) dateEnabled = false;
  } else {
    if (dailyLogEnabled === null) dailyLogEnabled = true;
    if (dateEnabled === null) dateEnabled = true;
  }

  const created = await prisma.sopResponsibility.create({
    data: {
      columnName,
      description: payload.description?.trim() ? String(payload.description).trim() : null,
      allocatedTo: payload.allocatedTo?.trim() ? String(payload.allocatedTo).trim() : null,
      email: payload.email?.trim() ? String(payload.email).trim() : null,
      dailyLog: payload.dailyLog?.trim() ? String(payload.dailyLog).trim() : null,
      date: dateVal,
      source,
      doneFromWhere: payload.doneFromWhere?.trim() ? String(payload.doneFromWhere).trim() : null,
      isManual: payload.isManual ?? (source === "MANUAL"),
      dailyLogEnabled: Boolean(dailyLogEnabled),
      dateEnabled: Boolean(dateEnabled),
    },
  });
  return created;
}
const createSopWithLog = withLog(createSop, (result) => ({
  action: "CREATE" as const,
  tableName: "SopResponsibility",
  recordId: String(result.id),
  details: `Created SOP "${result.columnName}" allocated to ${result.allocatedTo ?? "-"} (${result.email ?? "-"})`,
}));

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json();
    const result = await createSopWithLog(body);
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message || "Failed to create" }, { status });
  }
}
