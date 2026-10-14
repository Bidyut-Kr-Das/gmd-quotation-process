/**
 * Ofelia entry point for the Physical Stock cost / BOM ID derivation.
 *
 * Recomputes `cost` / `bom_id` for every PhysicalStock row. Reads the BOM graph
 * from the LOCAL database and writes the result to the NEON PhysicalStock table
 * (cross-database; see `@/schedular_function/run-physical-stock-cost-bom`).
 *
 * Deliberately thin: all logic lives in `@/schedular_function`. This file only
 * does the HTTP concerns — auth, status codes, and shaping the response.
 */

// Must be Node: the derive step uses the pg driver adapters for both the local
// and Neon databases.
export const runtime = "nodejs";

// Matches `wget -T 1800` in the ofelia script. The step reads the whole BOM
// graph and rewrites every PhysicalStock row, so it is budgeted like the other
// hourly jobs.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledPhysicalStockCostBom,
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
    const result = await runScheduledPhysicalStockCostBom();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-physical-stock-cost-bom] fatal: ${message}`, err);

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
    job: "physical-stock-cost-bom",
    auth: "ok",
    note: "POST to run the job. Reads the local BOM graph, writes cost/bom_id to Neon.",
  });
}

export async function HEAD(request: Request) {
  const auth = requireSyncApiKey(request);
  return new NextResponse(null, {
    status: auth.ok ? 200 : auth.status,
    headers: { Allow: "GET, POST" },
  });
}
