import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCleanCredentials, getAccessToken } from "@/lib/googleDrive";
import { getCostingDetails } from "@/services/smartsheetEnrichmentService";

export const runtime = "nodejs";

export async function POST() {
  try {
    if (!prisma) {
      return NextResponse.json({ success: false, error: "Database not available" }, { status: 500 });
    }

    const creds = getCleanCredentials();
    if (!creds) {
      return NextResponse.json({ success: false, error: "Google credentials not configured" }, { status: 500 });
    }

    let driveAccessToken: string | null = null;
    try {
      driveAccessToken = await getAccessToken(creds.email, creds.key);
    } catch {
      // Non-fatal — local files won't need it
    }

    const tenders = await prisma.tender.findMany({
      where: {
        attachmentUrl: { not: null },
        NOT: { attachmentUrl: "-" },
      },
      orderBy: { slNo: "asc" },
    });

    console.log(`[EnrichCVA] Found ${tenders.length} tenders with attachment URLs.`);

    let succeeded = 0;
    let failed = 0;

    for (const tender of tenders) {
      try {
        if (!tender.attachmentUrl || tender.attachmentUrl === "-") continue;

        const costing = await getCostingDetails(
          tender.attachmentUrl,
          tender.docketNo || "",
          driveAccessToken,
        );

        if (costing && costing.cva) {
          await prisma.tender.update({
            where: { id: tender.id },
            data: { cva: costing.cva },
          });
          succeeded++;
          console.log(`[EnrichCVA] Updated docket "${tender.docketNo}": cva="${costing.cva}"`);
        } else {
          failed++;
          console.warn(`[EnrichCVA] No CVA found for docket "${tender.docketNo}"`);
        }
      } catch (err) {
        failed++;
        console.error(`[EnrichCVA] Error for docket "${tender.docketNo}": ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      success: true,
      total: tenders.length,
      succeeded,
      failed,
    });
  } catch (err: any) {
    console.error(`[EnrichCVA] Route error: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
