import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { triggerEmdEmailWebhook } from "@/lib/integrations/n8n";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendEmdBgEmail(id: string, payload: { subject?: string; body?: string; html?: string; to?: string } | undefined) {
  const existing = await prisma.emdDetailsBG.findUnique({ where: { id } });
  if (!existing) throw new Error("Record to update does not exist");
  if (!existing.reason) throw new Error("Please select Tender Conclusion Reason before sending email");
  const to = (payload?.to ?? existing.contactEmailId ?? "").trim();
  const emails = to.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to || emails.length === 0 || emails.some((e) => !EMAIL_RE.test(e))) throw new Error("Valid contact email(s) (to) is required - comma separated");
  const subject = payload?.subject?.trim() || `Request for Release/Return of Bid Guarantee - ${existing.tenderNo || existing.tenderNo1 || id}`;
  const html = payload?.html || payload?.body || existing.emailDraft || "";
  if (!html || html.trim().length < 10) throw new Error("Email body/html is required");
  const body = payload?.body || html;

  const webhookResult = await triggerEmdEmailWebhook({
    to,
    subject,
    body,
    html,
    reason: existing.reason,
    tenderNo: existing.tenderNo || existing.tenderNo1 || existing.tenderNo2 || null,
    bgNo: existing.bgNo || null,
    id,
  });
  if (!webhookResult.success) {
    throw new Error(webhookResult.message || "Failed to send email via N8N webhook");
  }

  const now = new Date();
  const updated = await prisma.emdDetailsBG.update({
    where: { id },
    data: {
      lastEmailSentAt: now,
      lastEmailSent: subject,
      emailDraft: html,
    },
  });
  return updated;
}

const sendEmailWithLog = withLog(sendEmdBgEmail, (result, id, payload) => ({
  action: "UPDATE" as const,
  tableName: "EmdDetailsBG",
  recordId: String(id),
  details: `Sent email for EMD BG #${id} to="${(payload as any)?.to ?? ""}" subject="${(payload as any)?.subject ?? ""}" reason="${result.reason ?? ""}"`,
}));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
    let payload: any = undefined;
    try {
      payload = await req.json();
    } catch {
      payload = undefined;
    }
    const updated = await sendEmailWithLog(id, payload);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to send email";
    const status = msg.includes("Please select") || msg.includes("required") ? 400 : msg.includes("does not exist") ? 404 : 500;
    console.error("[API:POST /api/emd-details-bg/[id]/send-email] failed:", msg);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
