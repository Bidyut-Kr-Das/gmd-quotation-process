import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { TENDER_REASON_OPTIONS } from "@/lib/emdReasonOptions";
import { EMD_STATUS_OPTIONS } from "@/lib/emdStatusOptions";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function updateEmdDetailsBgFields(id: string, data: { reason?: string | null; contactEmailId?: string | null; contactNo?: string | null; status?: string | null }) {
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
  if (data.contactNo !== undefined) {
    const raw = data.contactNo === "" ? null : (data.contactNo as string)?.trim() ?? null;
    updateData.contactNo = raw;
  }
  if (data.status !== undefined) {
    const raw = data.status === "" ? null : (data.status as string)?.trim().toUpperCase() ?? null;
    if (raw !== null && !(EMD_STATUS_OPTIONS as readonly string[]).includes(raw)) throw new Error("Invalid status option");
    updateData.status = raw;
  }
  if (Object.keys(updateData).length === 0) throw new Error("No fields to update");
  const updated = await prisma.emdDetailsBG.update({ where: { id }, data: updateData });
  return updated;
}

const updateFieldsWithLog = withLog(updateEmdDetailsBgFields, (result, id, data) => ({
  action: "UPDATE" as const,
  tableName: "EmdDetailsBG",
  recordId: String(id),
  details: `Updated ${Object.keys(data).join(",")} on EMD BG #${id}`,
}));

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
    const body = await req.json();
    const data: any = {};
    if ("reason" in body) data.reason = body.reason as string | null;
    if ("contactEmailId" in body) data.contactEmailId = body.contactEmailId as string | null;
    if ("contactNo" in body) data.contactNo = body.contactNo as string | null;
    if ("status" in body) data.status = body.status as string | null;
    // backward compat: allow single reason payload without wrapper
    if (Object.keys(data).length === 0) {
      if ("reason" in body) data.reason = body.reason;
    }
    const updated = await updateFieldsWithLog(id, data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to update";
    const status = msg.includes("Invalid") ? 400 : msg.includes("Record to update does not exist") ? 404 : msg.includes("No fields") ? 400 : 500;
    console.error("[API:PATCH /api/emd-details-bg/[id]] failed:", msg);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
