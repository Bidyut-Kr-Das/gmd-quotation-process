import { NextRequest, NextResponse } from "next/server";
import { getUnmatchedDockets } from "@/services/monitoringService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const list = await getUnmatchedDockets();
    return NextResponse.json({ timestamp: Date.now(), count: list.length, data: list });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
