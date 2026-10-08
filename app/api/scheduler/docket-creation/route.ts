/**
 * Ofelia entry point for the hourly pending-docket creation.
 *
 * Materializes dockets for every `DocketQuotationThread` flagged
 * `pendingDocket = true`: creates a header-only `Enquiry`, links mail
 * attachments, generates the snapshot PDF, and stamps the thread with the new
 * docket number. Idempotent — a stamped thread leaves the pending set.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: the snapshot PDF uses puppeteer + the Google Drive API.
export const runtime = "nodejs";

// Matches `wget -T 900` in the ofelia script. The job is normally light (only
// flagged threads), but each docket renders and uploads one snapshot PDF.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledDocketCreation,
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
    const result = await runScheduledDocketCreation();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-docket-creation] fatal: ${message}`, err);

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without running the job.
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
    job: "docket-creation",
    auth: "ok",
    note: "POST to run the job. Idempotent: threads leave the pending set once stamped.",
  });
}
