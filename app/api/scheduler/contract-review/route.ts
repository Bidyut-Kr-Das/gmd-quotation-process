/**
 * Ofelia entry point for the Contract Review hourly sync.
 *
 * Runs three steps in order: CONTRACTS + DUMP sheet sync, Enquiry field
 * backfill, then RM AVAIL / VerifyBom / physical stock.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`. This file only
 * does the HTTP concerns — auth, status codes, and shaping the response.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json from
// the filesystem to reach Google Sheets.
export const runtime = "nodejs";

// Heavier than the Raw Material job — it reads two full-column spreadsheet
// reads and rewrites a large table. Matches `wget -T 1800` in the ofelia script.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledContractReview,
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
    const result = await runScheduledContractReview();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-contract-review] fatal: ${message}`, err);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// Credential probe. Ofelia only ever POSTs, but authenticating here gives a
// cheap way to verify the key is valid WITHOUT triggering a full sync, and
// answers the `GET` a human gets from typing the URL.
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
    job: "contract-review",
    auth: "ok",
    runs: ["sheetSync", "enquiry", "rmAvail"],
    note: "POST to run the job.",
  });
}

export async function HEAD(request: Request) {
  const auth = requireSyncApiKey(request);
  return new NextResponse(null, {
    status: auth.ok ? 200 : auth.status,
    headers: { Allow: "GET, POST" },
  });
}