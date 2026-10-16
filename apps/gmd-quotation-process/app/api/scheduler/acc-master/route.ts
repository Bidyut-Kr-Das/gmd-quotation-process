/**
 * Ofelia entry point for the hourly ACC_MASTER refresh.
 *
 * Copies the `ACC_MASTER_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`
 * into the local `acc_master` table, which the execution-tracking sync joins on
 * to resolve a consignee name without a Google call.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: `lib/googleAuth.ts` reads credentials.json / token.json.
export const runtime = "nodejs";

// Matches `wget -T 600` in the ofelia script. One small tab, so this is light.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledAccMaster,
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
    const result = await runScheduledAccMaster();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-acc-master] fatal: ${message}`, err);

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
    job: "acc-master",
    auth: "ok",
    note: "POST to refresh acc_master from the ACC_MASTER tab.",
  });
}
