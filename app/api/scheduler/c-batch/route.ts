/**
 * Ofelia entry point for the hourly C Batch sync.
 *
 * Marks `cBatch = "C"` on rows whose item code carries `ITEM_STATUS = "C"` in
 * ITEM MASTER ERP, across RawMaterial, ContractReview, SupplyHistoryItem and
 * EnquiryItem. Set-only: nothing is ever cleared.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json.
export const runtime = "nodejs";

// Matches `wget -T 600` in the ofelia script. This job reads one ~22k-row tab
// and updates four tables, so it is much lighter than the other three.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledCBatch,
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
    const result = await runScheduledCBatch();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-c-batch] fatal: ${message}`, err);

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
    job: "c-batch",
    auth: "ok",
    note: "POST to run the job. Set-only: existing marks are never cleared.",
  });
}