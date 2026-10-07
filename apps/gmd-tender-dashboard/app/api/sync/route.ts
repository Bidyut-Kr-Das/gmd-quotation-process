import { NextRequest, NextResponse } from "next/server";
import { executeSyncPipeline } from "@/services/syncPipeline";
import { requireAdminApi } from "@/lib/dal";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const forbidden = await requireAdminApi()
  if (forbidden) return forbidden

  try {
    const result = await executeSyncPipeline("MANUAL");
    if (result.success) {
      return NextResponse.json({ success: true, message: "Sync pipeline completed.", log: result.logEntry });
    }
    if (result.reason === "Already running") {
      return NextResponse.json({ success: true, message: "Sync already in progress." });
    }
    return NextResponse.json({ success: false, message: "Pipeline skipped or failed.", details: result.reason || result.error }, { status: 503 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
