import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { TENDER_REASON_OPTIONS } from "@/lib/emdReasonOptions";
import { EMD_STATUS_OPTIONS } from "@/lib/emdStatusOptions";

export const runtime = "nodejs";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmailsCSV(v: string) {
  return v.split(",").map((s) => s.trim()).filter(Boolean).every((e) => EMAIL_RE.test(e));
}

async function updateEmdMergedFields(id: string, data: { reason?: string | null; contactEmailId?: string | null; contactNo?: string | null; status?: string | null; remarks?: string | null; tmNo?: string | null; docketNo?: string | null; bgNo?: string | null }) {
  const updateData: any = {};
  if (data.reason !== undefined) {
    const reason = data.reason === "" ? null : data.reason;
    if (reason !== null && !(TENDER_REASON_OPTIONS as readonly string[]).includes(reason)) throw new Error("Invalid reason option");
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
  if (data.remarks !== undefined) {
    const raw = data.remarks === "" ? null : (data.remarks as string)?.trim() ?? null;
    updateData.remarks = raw;
  }
  if (data.tmNo !== undefined) {
    const raw = data.tmNo === "" ? null : (data.tmNo as string)?.trim() ?? null;
    updateData.tmNo = raw;
  }
  if (data.docketNo !== undefined) {
    const raw = data.docketNo === "" ? null : (data.docketNo as string)?.trim() ?? null;
    updateData.docketNo = raw;
  }
  if (data.bgNo !== undefined) {
    const raw = data.bgNo === "" ? null : (data.bgNo as string)?.trim() ?? null;
    updateData.bgNo = raw;
  }
  if (Object.keys(updateData).length === 0) throw new Error("No fields to update");
  const updated = await prisma.emdMerged.update({ where: { id }, data: updateData });
  return updated;
}

const updateWithLog = withLog(updateEmdMergedFields, (result, id, data) => ({
  action: "UPDATE" as const,
  tableName: "EmdMerged",
  recordId: String(id),
  details: `Updated ${Object.keys(data).join(",")} on EmdMerged #${id}`,
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
    if ("remarks" in body) data.remarks = body.remarks as string | null;
    if ("tmNo" in body) data.tmNo = body.tmNo as string | null;
    if ("docketNo" in body) data.docketNo = body.docketNo as string | null;
    if ("bgNo" in body) data.bgNo = body.bgNo as string | null;
    const updated = await updateWithLog(id, data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to update";
    const status = msg.includes("Invalid") ? 400 : msg.includes("does not exist") ? 404 : msg.includes("No fields") ? 400 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
