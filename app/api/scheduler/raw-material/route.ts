/**
 * Ofelia entry point for the Raw Material hourly sync.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`. This file only
 * does the HTTP concerns — auth, status codes, and shaping the response.
 *
 * Wired up in the infra repo as `GMD_SYNC_API_KEY` and called hourly by
 * `/scripts/api/gmd-update-sync.sh`.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json from
// the filesystem to reach Google Sheets.
export const runtime = "nodejs";

// Matches `wget -T 1800` in the ofelia script. A full sync over a few thousand
// rows plus the stock refresh can run for several minutes.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledGmdUpdate,
  SYNC_API_KEY_HEADER,
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
    const result = await runScheduledGmdUpdate();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-gmd-update] fatal: ${message}`, err);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// Ofelia only ever POSTs, but returning the accepted methods keeps the
// response honest for a manual `curl -i`.
export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST.",
      job: "raw-material",
      auth: `x-api-key header (${SYNC_API_KEY_HEADER})`,
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}