import { NextRequest, NextResponse } from "next/server";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ saleBillNumber: string }> }) {
  try {
    const { saleBillNumber } = await params;
    const authHeader = req.headers.get("authorization") || req.nextUrl.searchParams.get("auth") || null;
    const result = await TenderAttachmentController.getSupplyBillFiles(saleBillNumber, authHeader);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 500 });
  }
}
