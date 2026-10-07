import { NextRequest, NextResponse } from "next/server";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenderId: string }> }) {
  try {
    const { tenderId } = await params;
    // console.log(`[DEBUG files/route] INCOMING REQUEST for tenderId=${tenderId}`);
    const authHeader = req.headers.get("authorization") || req.nextUrl.searchParams.get("auth") || null;
    const result = await TenderAttachmentController.getTenderFiles(tenderId, authHeader);
    // console.log(`[DEBUG files/route] RESPONSE for ${tenderId}: ${result.files.length} files`);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error(`[DEBUG files/route] ERROR:`, err.message);
    return NextResponse.json({ error: err.error || err.message }, { status: err.status || 404 });
  }
}
