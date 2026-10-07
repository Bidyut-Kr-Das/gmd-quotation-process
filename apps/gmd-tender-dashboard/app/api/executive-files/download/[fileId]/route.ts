import { NextRequest, NextResponse } from "next/server";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await params;
    const authHeader = req.headers.get("authorization") || req.nextUrl.searchParams.get("auth") || null;
    const { stream, headers } = await TenderAttachmentController.downloadFile(fileId, authHeader);
    return new Response(stream as any, { headers });
  } catch (err: any) {
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 400 });
  }
}
