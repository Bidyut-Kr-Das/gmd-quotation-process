import { NextRequest, NextResponse } from "next/server";
import { TenderController } from "@/controllers/tenderController";
import { logActivity } from "@/lib/activity-logger";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenderId: string }> }) {
  try {
    const { tenderId } = await params;
    const body = await req.json();
    console.log(`[api:diff] PATCH called tenderId=${tenderId} body=`, body);
    const result = await TenderController.updateDiffPercents(tenderId, body);
    console.log(`[api:diff] success tenderId=${tenderId}`);
    const parts: string[] = [];
    if (body.diffPercentFromL1 !== undefined) parts.push(`diffL1=${body.diffPercentFromL1}`);
    if (body.diffPercentFromL2 !== undefined) parts.push(`diffL2=${body.diffPercentFromL2}`);
    const tender = await prisma.tender.findUnique({ where: { id: tenderId }, select: { tenderNoNitNo: true } });
    logActivity({
      action: "UPDATE",
      tableName: "Tender",
      recordId: tenderId,
      referenceNo: tender?.tenderNoNitNo ?? undefined,
      details: `Updated tender diff percents: ${parts.join(", ")}`,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 500 });
  }
}
