import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { TENDER_REASON_OPTIONS } from "@/lib/emdReasonOptions";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function updateEmdDetailsCashFields(id: number, data: { reason?: string | null; contactEmailId?: string | null }) {
  const updateData: any = {};
  if (data.reason !== undefined) {
    const reason = data.reason === "" ? null : data.reason;
    if (reason !== null && !(TENDER_REASON_OPTIONS as readonly string[]).includes(reason)) {
      throw new Error("Invalid reason option");
    }
    updateData.reason = reason;
  }
  if (data.contactEmailId !== undefined) {
    const raw = data.contactEmailId === "" ? null : (data.contactEmailId as string)?.trim() ?? null;
    if (raw !== null) {
      const bad = raw.split(",").map((s) => s.trim()).filter(Boolean).filter((e) => !EMAIL_RE.test(e));
      if (bad.length) throw new Error(`Invalid contact email(s): ${bad.join(", ")}`);
    }
    updateData.contactEmailId = raw;
  }
  if (Object.keys(updateData).length === 0) throw new Error("No fields to update");
  const updated = await prisma.emdDetailsCash.update({ where: { id }, data: updateData });
  return updated;
}

const updateFieldsWithLog = withLog(updateEmdDetailsCashFields, (result, id, data) => ({
  action: "UPDATE" as const,
  tableName: "EmdDetailsCash",
  recordId: String(id),
  details: `Updated ${Object.keys(data).join(",")} on EMD Cash #${id}`,
}));

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!rawId || Number.isNaN(id)) return NextResponse.json({ success: false, error: "Missing or invalid id" }, { status: 400 });
    const body = await req.json();
    const data: any = {};
    if ("reason" in body) data.reason = body.reason as string | null;
    if ("contactEmailId" in body) data.contactEmailId = body.contactEmailId as string | null;
    const updated = await updateFieldsWithLog(id, data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to update";
    const status = msg.includes("Invalid") ? 400 : msg.includes("Record to update does not exist") ? 404 : msg.includes("No fields") ? 400 : 500;
    console.error("[API:PATCH /api/emd-details-cash/[id]] failed:", msg);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
