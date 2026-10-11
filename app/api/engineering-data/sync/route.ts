import { NextResponse } from "next/server";
import { findTab } from "@/lib/technical/tableConfig";
import {
  getLastSyncAt,
  syncAllEngineeringTabs,
  syncEngineeringTab,
} from "@/lib/technical/syncEngineering";

/**
 * POST /api/engineering-data/sync
 *
 * Pulls rows from the Google Sheet into Postgres. This is the only endpoint
 * that touches Google; the read API serves the UI purely from the database.
 *
 *   ?tab=<key>  sync just that tab (what the header Sync button sends)
 *   (no tab)    sync all tabs
 *   ?force=1    bypass the cooldown
 *
 * Deliberately ungated, per the requirement for a plain "Sync" button. The
 * blast radius is bounded by a per-tab 60s cooldown plus an in-flight guard, so
 * a burst of requests cannot hammer the Sheets API or the database.
 */
export const dynamic = "force-dynamic";

const COOLDOWN_MS = 60_000;

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const tabParam = params.get("tab");

  // An explicit unknown tab is a client error; an absent one means "all tabs".
  if (tabParam && !findTab(tabParam)) {
    return NextResponse.json(
      { error: "Unknown tab", tab: tabParam },
      { status: 404 },
    );
  }

  if (!force) {
    const since = Date.now() - getLastSyncAt(tabParam ?? undefined);
    if (getLastSyncAt(tabParam ?? undefined) > 0 && since < COOLDOWN_MS) {
      return NextResponse.json(
        {
          error: "Sync was run less than a minute ago. Try again shortly.",
          retryAfterMs: COOLDOWN_MS - since,
        },
        { status: 429 },
      );
    }
  }

  try {
    const results = tabParam
      ? await syncEngineeringTab(tabParam)
      : await syncAllEngineeringTabs();
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json(
      { ok: failed.length === 0, results },
      // 207 when some tabs succeeded and some failed, so the caller sees partial
      // success rather than a blanket error.
      { status: failed.length === 0 ? 200 : 207 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The sync could not be started.";
    console.error("[engineering-data] sync:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
