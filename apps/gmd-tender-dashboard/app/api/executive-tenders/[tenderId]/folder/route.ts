import { NextRequest, NextResponse } from "next/server";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenderId: string }> }) {
  try {
    const { tenderId } = await params;
    const authHeader = req.headers.get("authorization") || req.nextUrl.searchParams.get("auth") || null;
    const result = await TenderAttachmentController.getTenderFolderDetails(tenderId, authHeader);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 404 });
  }
}
