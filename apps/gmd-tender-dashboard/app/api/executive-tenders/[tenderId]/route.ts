import { NextRequest, NextResponse } from "next/server";
import { TenderController } from "@/controllers/tenderController";
import { logActivity } from "@/lib/activity-logger";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenderId: string }> }) {
  try {
    const { tenderId } = await params;
    const body = await req.json();
    const result = await TenderController.updateTender(tenderId, body);
    const { tenderUpdateStatus, nextAction } = body;
    const tender = await prisma.tender.findUnique({ where: { id: tenderId }, select: { tenderNoNitNo: true } });
    logActivity({
      action: "UPDATE",
      tableName: "Tender",
      recordId: tenderId,
      referenceNo: tender?.tenderNoNitNo ?? undefined,
      details: `Updated tender status="${tenderUpdateStatus}"${nextAction ? `, nextAction="${nextAction}"` : ""}`,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 500 });
  }
}
