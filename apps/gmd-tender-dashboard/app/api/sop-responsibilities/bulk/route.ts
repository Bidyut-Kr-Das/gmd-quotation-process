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

interface BulkInputRow {
  columnName?: string;
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
}

const ALLOWED_SOURCES = new Set(["MANUAL","UPLOAD_EXCEL","SCRAPE_247","AI","DOCUMENT_PARSE","RA_AUTOMATION","GOOGLE_SHEET_SYNC","SYSTEM"]);
const AUTO_FALSE_SOURCES = new Set(["AI","DOCUMENT_PARSE","RA_AUTOMATION","SCRAPE_247"]);

async function bulkCreateSop(payload: { rows: BulkInputRow[] }) {
  const rows = payload.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw Object.assign(new Error("rows array required and non-empty"), { status: 400 });
  }
  if (rows.length > 200) throw Object.assign(new Error("Too many rows (max 200)"), { status: 400 });

  const errors: { index: number; field: string; message: string }[] = [];
  const validData: {
    columnName: string;
    description: string | null;
    allocatedTo: string | null;
    email: string | null;
    dailyLog: string | null;
    date: Date | null;
    source: string | null;
    doneFromWhere: string | null;
    isManual: boolean;
    dailyLogEnabled: boolean;
    dateEnabled: boolean;
  }[] = [];

  rows.forEach((r, idx) => {
    const col = String(r.columnName ?? "").trim();
    if (!col) {
      errors.push({ index: idx, field: "columnName", message: "columnName required" });
      return;
    }
    if (col.length > 200) {
      errors.push({ index: idx, field: "columnName", message: "columnName too long (max 200)" });
      return;
    }
    if (r.email) {
      const e = String(r.email).trim();
      if (e && !isValidEmail(e)) {
        errors.push({ index: idx, field: "email", message: `Invalid email: ${e}` });
        return;
      }
    }
    let source: string | null = r.source?.trim() ? String(r.source).trim().toUpperCase() : null;
    if (source && !ALLOWED_SOURCES.has(source)) {
      errors.push({ index: idx, field: "source", message: `Invalid source: ${source}` });
      return;
    }
    let dateVal: Date | null = null;
    if (r.date) {
      dateVal = parseIstDateToUTC(String(r.date));
      if (!dateVal) {
        errors.push({ index: idx, field: "date", message: "Invalid date, expected YYYY-MM-DD" });
        return;
      }
    }
    let dailyLogEnabled: boolean = r.dailyLogEnabled ?? null as any;
    let dateEnabled: boolean = r.dateEnabled ?? null as any;
    if (dailyLogEnabled === null || dailyLogEnabled === undefined) dailyLogEnabled = source && AUTO_FALSE_SOURCES.has(source) ? false : true;
    if (dateEnabled === null || dateEnabled === undefined) dateEnabled = source && AUTO_FALSE_SOURCES.has(source) ? false : true;
    // Fully empty row check: if user left blank row, treat as invalid? Caller filters fully empty.
    validData.push({
      columnName: col,
      description: r.description?.trim() ? String(r.description).trim() : null,
      allocatedTo: r.allocatedTo?.trim() ? String(r.allocatedTo).trim() : null,
      email: r.email?.trim() ? String(r.email).trim() : null,
      dailyLog: r.dailyLog?.trim() ? String(r.dailyLog).trim() : null,
      date: dateVal,
      source,
      doneFromWhere: r.doneFromWhere?.trim() ? String(r.doneFromWhere).trim() : null,
      isManual: r.isManual ?? (source === "MANUAL"),
      dailyLogEnabled: Boolean(dailyLogEnabled),
      dateEnabled: Boolean(dateEnabled),
    });
  });

  let created: any[] = [];
  if (validData.length > 0) {
    // Use transaction to create sequentially for id return; createMany doesn't return rows on PG easily without returning.
    // Do batch via $transaction
    const tx = await prisma.$transaction(
      validData.map((d) => prisma.sopResponsibility.create({ data: d }))
    );
    created = tx;
  }

  return { created, errors, total: rows.length, validCount: validData.length };
}

const bulkCreateWithLog = withLog(bulkCreateSop, (result, payload) => ({
  action: "CREATE" as const,
  tableName: "SopResponsibility",
  details: `Bulk SOP: ${result.created.length}/${payload.rows.length} created, ${result.errors.length} validation errors`,
}));

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json();
    const rows: BulkInputRow[] = Array.isArray(body.rows) ? body.rows : Array.isArray(body) ? body : [];
    // Filter fully empty rows (all fields empty)
    const filtered = rows.filter((r) => {
      const hasAny =
        String(r.columnName ?? "").trim() ||
        String(r.description ?? "").trim() ||
        String(r.allocatedTo ?? "").trim() ||
        String(r.email ?? "").trim() ||
        String(r.dailyLog ?? "").trim() ||
        String(r.date ?? "").trim();
      return !!hasAny;
    });
    if (filtered.length === 0) return NextResponse.json({ success: false, error: "No valid rows provided" }, { status: 400 });

    const result = await bulkCreateWithLog({ rows: filtered });
    return NextResponse.json({
      success: true,
      data: result.created,
      created: result.created.length,
      total: result.total,
      errors: result.errors,
    });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message || "Bulk create failed" }, { status });
  }
}
