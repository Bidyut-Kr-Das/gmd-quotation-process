import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { triggerEmdEmailWebhook } from "@/lib/integrations/n8n";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmailsCSV(v: string) {
  return v.split(",").map((s) => s.trim()).filter(Boolean).every((e) => EMAIL_RE.test(e));
}

async function sendEmdMergedEmail(id: string, payload: { subject?: string; body?: string; html?: string; to?: string } | undefined) {
  const existing = await prisma.emdMerged.findUnique({ where: { id } });
  if (!existing) throw new Error("Record to update does not exist");
  if (!existing.reason) throw new Error("Please select Tender Conclusion Reason before sending email");
  const to = (payload?.to ?? existing.contactEmailId ?? "").trim();
  if (!to || !isValidEmailsCSV(to)) throw new Error("Valid contact email(s) (to) is required - comma separated");
  const invalid = to.split(",").map((s) => s.trim()).filter(Boolean).filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) throw new Error(`Invalid email(s): ${invalid.join(", ")}`);
  const tenderNo = existing.tenderNo || existing.tmNo || id;
  const subject = payload?.subject?.trim() || `Request for Release/Return of EMD - ${tenderNo}`;
  const html = payload?.html || payload?.body || existing.emailDraft || "";
  if (!html || html.trim().length < 10) throw new Error("Email body/html is required");
  const body = payload?.body || html;

  const webhookResult = await triggerEmdEmailWebhook({
    to,
    subject,
    body,
    html,
    reason: existing.reason,
    tenderNo,
    bgNo: existing.bgNo || null,
    id,
  });
  if (!webhookResult.success) throw new Error(webhookResult.message || "Failed to send email via N8N webhook");

  const now = new Date();
  const updated = await prisma.emdMerged.update({
    where: { id },
    data: { lastEmailSentAt: now, lastEmailSent: subject, emailDraft: html },
  });
  return updated;
}

const sendWithLog = withLog(sendEmdMergedEmail, (result, id, payload) => ({
  action: "UPDATE" as const,
  tableName: "EmdMerged",
  recordId: String(id),
  details: `Sent email for EmdMerged #${id} to="${(payload as any)?.to ?? ""}" emdType="${(result as any).emdType ?? ""}"`,
}));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
    let payload: any = undefined;
    try { payload = await req.json(); } catch { payload = undefined; }
    const updated = await sendWithLog(id, payload);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const msg = err.message ?? "Failed to send email";
    const status = msg.includes("Please select") || msg.includes("required") ? 400 : msg.includes("does not exist") ? 404 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
