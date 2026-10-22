import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { generateCertificatePdf } from "@/lib/generate-offer-pdf";
import { uploadFileToDrive } from "@/lib/gdrive";
import { withLog } from "@/lib/activity-logger";
import { prisma } from "@/lib/prisma";
import { DatabaseSupplyService } from "@/services/databaseSupplyService";
import { CertificateTemplateData } from "@/app/types/certificate";
import { SupplyHistoryRecord } from "@/types/supplyHistory";

const CERTIFICATE_FOLDER_ID = "1tbNdp-iwMeB9dO35xR35bGyuPmTLCfha";

let templateSource: string | null = null;

function loadTemplate(): string {
  if (!templateSource) {
    templateSource = fs.readFileSync(
      path.join(process.cwd(), "certificate_of_satisfactory_performance.hbs"),
      "utf-8"
    );
  }
  return templateSource;
}

function mapRowsToCertificateData(rows: SupplyHistoryRecord[]): CertificateTemplateData {
  const first = rows[0];
  const totalAmt = rows.reduce((sum, r) => sum + (r.invoiceAmt ?? 0), 0);
  return {
    partyRefNo: first.partyRefNo ?? "",
    partyRefDate: first.partyRefDate ?? "",
    partyName: first.partyName ?? "",
    fy: first.fy ?? "",
    invoiceAmt: totalAmt.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
    items: rows.map((r) => ({
      itemName: r.itemName ?? "",
      invoiceQty: r.invoiceQty ?? 0,
      saleBillDate: r.saleBillDate ?? "",
    })),
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
}

async function runGenerateCertificate(request: NextRequest) {
  const body = await request.json();
  const { rows } = body as { rows: SupplyHistoryRecord[] };

  if (!rows || rows.length === 0) {
    const err: any = new Error("No rows provided");
    err.status = 400;
    throw err;
  }

  const data = mapRowsToCertificateData(rows);
  const partyRefNo = data.partyRefNo || "NAN";

  const prevCount = await prisma.activityLog.count({
    where: { referenceNo: partyRefNo, action: "GENERATE_CERTIFICATE_PDF" },
  });
  const version = prevCount + 1;

  const versionedFileName = `Certificate_${partyRefNo}_${sanitizeFileName(data.partyName || "Unknown")}_v${version}.pdf`;

  const template = loadTemplate();

  const tempPath = path.join(os.tmpdir(), `cert_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`);

  const pdfBuffer = await generateCertificatePdf(template, data, { outputPath: tempPath });

  const base64 = pdfBuffer.toString("base64");
  const driveResult = await uploadFileToDrive(versionedFileName, "application/pdf", base64, CERTIFICATE_FOLDER_ID);

  try {
    fs.unlinkSync(tempPath);
  } catch {}

  // Persist certificateUrl to SupplyHistory for email sending
  try {
    await DatabaseSupplyService.persistCertificateForPartyRef(partyRefNo, driveResult.url, versionedFileName);
  } catch (e) {
    console.warn("[generate-certificate] Failed to persist certificateUrl:", e);
  }

  return {
    partyRefNo,
    version,
    fileName: versionedFileName,
    driveUrl: driveResult.url,
    pdfBuffer,
    data,
  };
}

const generateCertificateWithLog = withLog(
  runGenerateCertificate,
  (result) => ({
    action: "GENERATE_CERTIFICATE_PDF" as const,
    tableName: "SupplyHistory",
    referenceNo: result.partyRefNo,
    details: JSON.stringify({
      version: result.version,
      partyRefNo: result.data.partyRefNo,
      partyName: result.data.partyName,
      fy: result.data.fy,
      itemCount: result.data.items.length,
      invoiceAmt: result.data.invoiceAmt,
      driveUrl: result.driveUrl,
      fileName: result.fileName,
    }),
  }),
);

export async function POST(request: NextRequest) {
  try {
    const result = await generateCertificateWithLog(request);
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Drive-Url": result.driveUrl,
      },
    });
  } catch (error: any) {
    const status = error.status || 500;
    if (status === 400) {
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Certificate generation failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate certificate" },
      { status: 500 }
    );
  }
}

export { mapRowsToCertificateData, sanitizeFileName };
