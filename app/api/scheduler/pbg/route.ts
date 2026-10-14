/**
 * Ofelia entry point for the PBG hourly sheet sync.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`. This file only
 * does the HTTP concerns — auth, status codes, and shaping the response.
 */

// Google Sheets is reached over `fetch` with OAuth env vars; keep it on Node
// for consistency with the other scheduler routes.
export const runtime = "nodejs";

// Matches `wget -T 600` in the ofelia script. The sync reads one sheet tab and
// upserts a small table, so this is a light job.
export const maxDuration = 600;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledPbg,
} from "@/schedular_function";

export async function POST(request: Request) {
  // 503 if GMD_SYNC_API_KEY is unset on the server, 401 if the key is wrong.
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const result = await runScheduledPbg();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-pbg] fatal: ${message}`, err);

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without running the sync.
export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  return NextResponse.json({
    success: true,
    job: "pbg",
    auth: "ok",
    runs: ["sync"],
    note: "POST to run the job.",
  });
}
