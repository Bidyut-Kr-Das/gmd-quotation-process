/**
 * Ofelia entry point for the Execution Tracking sync (every 2 hours).
 *
 * Refreshes `acc_master`, then diffs the `SALE_BILL_GID` tab of
 * `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` into `SupplyHistoryItem` for the
 * current fiscal year (April start).
 *
 * Manual checks: `?dryRun=1` reports without writing, and `?fy=2025-26` targets
 * a different year. The POST body accepts the same two fields.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json.
export const runtime = "nodejs";

// Matches `wget -T 600` in the ofelia script. One tab read plus the writes.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledExecutionTracking,
} from "@/schedular_function";

type Options = { dryRun: boolean; financialYear?: string };

async function readOptions(request: Request): Promise<Options> {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: unknown;
    financialYear?: unknown;
  };

  const dryRun =
    body.dryRun === true ||
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dryRun") === "true";

  const fromBody =
    typeof body.financialYear === "string" ? body.financialYear : undefined;
  const financialYear = fromBody ?? url.searchParams.get("fy") ?? undefined;

  return { dryRun, financialYear };
}

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
    const options = await readOptions(request);
    const result = await runScheduledExecutionTracking(options);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-execution-tracking] fatal: ${message}`, err);

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
    job: "execution-tracking",
    auth: "ok",
    note: "POST to run the job; add ?dryRun=1 to report without writing, ?fy=2025-26 for another year.",
  });
}
