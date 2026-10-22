import { NextResponse } from "next/server";
import { runBomMastErpSync } from "@/schedular_function/bom-mast-sync";

// Reads credentials.json / token.json from disk, so it must run on Node.
export const runtime = "nodejs";

export const maxDuration = 1800;

/**
 * Manual trigger for the BOM MAST ERP -> FullItem/Bom/BomItem sync.
 *
 * Thin HTTP wrapper around the shared, action-free service. The hourly
 * scheduler (`POST /api/scheduler/bom-mast`) calls the exact same function, so
 * the two paths cannot drift.
 */
export async function POST() {
  try {
    const result = await runBomMastErpSync();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error syncing BOM MAST ERP -> Bom/BomItem:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
