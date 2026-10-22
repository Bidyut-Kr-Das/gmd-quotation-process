import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";

export const runtime = "nodejs";

async function sendEmdCashEmail(idNum: number) {
  const existing = await prisma.emdDetailsCash.findUnique({ where: { id: idNum } });
  if (!existing) throw new Error("Record to update does not exist");
  if (!existing.reason) throw new Error("Please select Tender Conclusion Reason before sending email");
  const now = new Date();
  const updated = await prisma.emdDetailsCash.update({
    where: { id: idNum },
    data: {
      lastEmailSentAt: now,
    },
  });
  return updated;
}

const sendEmailWithLog = withLog(sendEmdCashEmail, (result, idNum) => ({
  action: "UPDATE" as const,
  tableName: "EmdDetailsCash",
  recordId: String(idNum),
  details: `Sent email for EMD Cash #${idNum} reason="${result.reason ?? ""}"`,
}));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!rawId || Number.isNaN(id)) return NextResponse.json({ success: false, error: "Missing or invalid id" }, { status: 400 });
    const updated = await sendEmailWithLog(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to send email";
    const status = msg.includes("Please select") ? 400 : msg.includes("does not exist") ? 404 : 500;
    console.error("[API:POST /api/emd-details-cash/[id]/send-email] failed:", msg);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
