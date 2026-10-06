/**
 * Ofelia entry point for the Supply History hourly MASTER sync.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`. This file only
 * does the HTTP concerns — auth, status codes, and shaping the response.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json from
// the filesystem to reach Google Sheets.
export const runtime = "nodejs";

// Matches `wget -T 1800` in the ofelia script. The touch loop alone can run over
// the whole SupplyHistoryItem table, so this is the longest of the hourly jobs.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledSupplyHistory,
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
    const result = await runScheduledSupplyHistory();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-supply-history] fatal: ${message}`, err);

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
    job: "supply-history",
    auth: "ok",
    runs: ["masterSync"],
    note: "POST to run the job.",
  });
}