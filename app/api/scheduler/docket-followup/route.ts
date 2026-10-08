import { NextResponse } from "next/server";
import {
  requireSyncApiKey,
  runDocketFollowupSync,
} from "@/schedular_function";

export const runtime = "nodejs";
export const maxDuration = 1800;

export async function POST(request: Request) {
  // Allow authenticated API key or allow internal app triggers
  const auth = requireSyncApiKey(request);
  const isInternalAppCall = request.headers.get("x-app-source") === "gmd-dashboard";

  if (!auth.ok && !isInternalAppCall) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  try {
    const url = new URL(request.url);
    const fullScan = url.searchParams.get("full") === "true";
    const result = await runDocketFollowupSync({ fullScan });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-docket-followup] fatal: ${message}`, err);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fullScan = url.searchParams.get("full") === "true";
    const result = await runDocketFollowupSync({ fullScan });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

