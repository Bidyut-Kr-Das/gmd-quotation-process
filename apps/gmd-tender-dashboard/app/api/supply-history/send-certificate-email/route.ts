import { NextRequest, NextResponse } from "next/server";
import { withLog } from "@/lib/activity-logger";
import { prisma } from "@/lib/prisma";
import { triggerCertificateEmailWebhook } from "@/lib/integrations/n8n";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isValidEmail);
}

function getDriveDownloadUrl(driveUrl: string): string {
  // Convert https://drive.google.com/file/d/<id>/view... to download url
  const match = driveUrl.match(/\/file\/d\/([^/]+)/) || driveUrl.match(/[?&]id=([^&]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  return driveUrl;
}

async function runSendCertificateEmail(params: { partyRefNo: string }) {
  const { partyRefNo } = params;
  if (!partyRefNo || !partyRefNo.trim()) {
    const err: any = new Error("partyRefNo is required");
    err.status = 400;
    throw err;
  }

  const trimmedRef = partyRefNo.trim();

  const rows = await prisma.supplyHistory.findMany({
    where: { partyRefNo: trimmedRef },
  });

  if (!rows.length) {
    const err: any = new Error(`No SupplyHistory records found for partyRefNo ${trimmedRef}`);
    err.status = 404;
    throw err;
  }

  // Collect distinct emails across grouped rows: first -> To, rest -> Cc
  const allEmails: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const parsed = parseEmails(r.email);
    for (const e of parsed) {
      const lower = e.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        allEmails.push(e);
      }
    }
  }

  if (allEmails.length === 0) {
    const err: any = new Error("No recipient email found for this party. Please add Email in the dashboard first.");
    err.status = 400;
    throw err;
  }

  const to = allEmails[0];
  const cc = allEmails.slice(1);

  // Certificate persisted column: take first row with url
  const certRow = rows.find((r) => r.certificateUrl) || rows[0];
  const driveUrl = (certRow as any).certificateUrl as string | null;
  const fileName = (certRow as any).certificateFileName as string | null;

  if (!driveUrl) {
    const err: any = new Error("Certificate not generated yet. Please generate the certificate first.");
    err.status = 400;
    throw err;
  }

  const finalFileName = fileName || `Certificate_${trimmedRef}.pdf`;

  // Fetch PDF from Drive URL as attachment
  let pdfBuffer: Buffer | null = null;
  const downloadUrl = getDriveDownloadUrl(driveUrl);
  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Drive fetch returned ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0) throw new Error("Empty file from Drive");
    // Detect HTML login page (when drive file not public)
    const head = Buffer.from(ab.slice(0, 200)).toString("utf-8").toLowerCase();
    if (head.includes("<html") && head.includes("google")) {
      throw new Error("Drive file not accessible (check sharing permissions)");
    }
    pdfBuffer = Buffer.from(ab);
  } catch (e: any) {
    console.warn("[send-certificate-email] Drive fetch failed, will try direct url:", e?.message);
    // Fallback: try direct driveUrl fetch
    try {
      const res2 = await fetch(driveUrl);
      if (res2.ok) {
        const ab2 = await res2.arrayBuffer();
        if (ab2.byteLength > 0) pdfBuffer = Buffer.from(ab2);
      }
    } catch {}
  }

  // Final fallback: regenerate PDF server-side if Drive fetch failed
  if (!pdfBuffer) {
    // Use the same generation path: import lazily to avoid circular
    const { generateCertificatePdf } = await import("@/lib/generate-offer-pdf");
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const templateSource = fs.readFileSync(path.join(process.cwd(), "certificate_of_satisfactory_performance.hbs"), "utf-8");
    // Build CertificateTemplateData from rows
    const first = rows[0] as any;
    const totalAmt = rows.reduce((sum: number, r: any) => sum + (r.invoiceQty ?? 0 ? r.invoiceAmt ?? 0 : r.invoiceAmt ?? 0), 0);
    // Use invoiceAmt sum correctly (same as generate route)
    const total = rows.reduce((sum: number, r: any) => sum + (r.invoiceAmt ?? 0), 0);
    const data = {
      partyRefNo: first.partyRefNo ?? "",
      partyRefDate: first.partyRefDate ?? "",
      partyName: first.partyName ?? "",
      fy: first.fy ?? "",
      invoiceAmt: total.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
      items: rows.map((r: any) => ({
        itemName: r.itemName ?? "",
        invoiceQty: r.invoiceQty ?? 0,
        saleBillDate: r.saleBillDate ?? "",
      })),
    };
    const tmpPath = path.join(os.tmpdir(), `cert_email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
    pdfBuffer = await generateCertificatePdf(templateSource, data as any, { outputPath: tmpPath });
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }

  if (!pdfBuffer) {
    const err: any = new Error("Failed to obtain certificate PDF");
    err.status = 500;
    throw err;
  }

  // Collect dynamic certificate details for payload
  const firstRow: any = rows[0];
  const invoiceAmt = rows.reduce((sum: number, r: any) => sum + (r.invoiceAmt ?? 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const payload = {
    to,
    cc,
    partyRefNo: trimmedRef,
    partyName: firstRow.partyName ?? "",
    partyRefDate: firstRow.partyRefDate ?? "",
    fy: firstRow.fy ?? "",
    invoiceAmt,
    fileName: finalFileName,
    driveUrl,
    itemCount: rows.length,
  };

  const result = await triggerCertificateEmailWebhook(payload, pdfBuffer);

  if (!result.success) {
    const err: any = new Error(result.message || "Failed to send email via n8n");
    err.status = 502;
    throw err;
  }

  // Persist certificateSentDate for all rows sharing this partyRefNo (overwrite with latest on each successful send)
  let certificateSentDate: string | null = null;
  try {
    const sentAt = new Date();
    await prisma.supplyHistory.updateMany({
      where: { partyRefNo: trimmedRef },
      data: { certificateSentDate: sentAt },
    });
    certificateSentDate = sentAt.toISOString();
  } catch (e: any) {
    console.warn("[send-certificate-email] Failed to persist certificateSentDate:", e?.message);
  }

  return { partyRefNo: trimmedRef, to, cc, fileName: finalFileName, driveUrl, certificateSentDate };
}

const sendCertificateEmailWithLog = withLog(
  runSendCertificateEmail,
  (result, params) => ({
    action: "UPDATE" as const,
    tableName: "SupplyHistory",
    referenceNo: result.partyRefNo,
    details: `Certificate email sent for partyRefNo ${result.partyRefNo} to ${result.to} cc [${result.cc.join(", ")}] file ${result.fileName} at ${result.certificateSentDate ?? new Date().toISOString()}`,
  }),
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const partyRefNo = (body as any).partyRefNo as string | undefined;
    const result = await sendCertificateEmailWithLog({ partyRefNo: partyRefNo ?? "" });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[send-certificate-email] Failed:", error);
    const status = error.status || 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send certificate email" },
      { status },
    );
  }
}
