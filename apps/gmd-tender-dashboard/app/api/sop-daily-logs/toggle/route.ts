import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { auth } from "@/auth";

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

async function toggleLog(payload: { sopResponsibilityId: number; date: string; isChecked: boolean }) {
  const { sopResponsibilityId, date, isChecked } = payload;
  if (!sopResponsibilityId || isNaN(Number(sopResponsibilityId))) throw Object.assign(new Error("sopResponsibilityId required"), { status: 400 });
  if (!date) throw Object.assign(new Error("date required YYYY-MM-DD"), { status: 400 });
  const dateVal = parseIstDateToUTC(String(date));
  if (!dateVal) throw Object.assign(new Error("Invalid date"), { status: 400 });
  const idNum = Number(sopResponsibilityId);
  // ensure SOP exists
  const sop = await prisma.sopResponsibility.findUnique({ where: { id: idNum } });
  if (!sop) throw Object.assign(new Error("SOP not found"), { status: 404 });

  // anyone authenticated can toggle per spec; we pass checkedBy
  // checkedBy will be set by wrapper via auth
  return { sop, dateVal, idNum, isChecked: !!isChecked };
}

// we need checkedBy from auth, so wrap differently: do auth inside handler then call withLog inner
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const parsed = await toggleLog(body);
    const checkedBy = session.user.email || session.user.name || "unknown";

    const doUpsert = async () => {
      const upserted = await prisma.sopDailyLog.upsert({
        where: { sopResponsibilityId_date: { sopResponsibilityId: parsed.idNum, date: parsed.dateVal } },
        update: { isChecked: parsed.isChecked, checkedBy, checkedAt: new Date() },
        create: { sopResponsibilityId: parsed.idNum, date: parsed.dateVal, isChecked: parsed.isChecked, checkedBy, checkedAt: new Date() },
      });
      return upserted;
    };
    const upsertWithLog = withLog(doUpsert, (result) => ({
      action: "UPDATE" as const,
      tableName: "SopDailyLog",
      recordId: String(result.id),
      details: `Toggle SOP#${parsed.idNum} ${body.date} -> ${parsed.isChecked ? "checked" : "unchecked"} by ${checkedBy}`,
    }));
    const result = await upsertWithLog();
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
