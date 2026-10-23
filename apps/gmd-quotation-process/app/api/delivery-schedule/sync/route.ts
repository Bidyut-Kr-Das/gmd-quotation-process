/**
 * Delivery schedule sync — HTTP entry point, no cron of its own.
 *
 * Replicates the in-app behaviour (stock mirror + derived schedule) for any
 * caller holding `GMD_SYNC_API_KEY`: n8n, infra, another service.
 *
 *   POST /api/delivery-schedule/sync
 *   x-api-key: $GMD_SYNC_API_KEY
 *   { "dryRun": true, "enquiryId"?: string, "docketNumber"?: string,
 *     "itemIds"?: string[], "clearOverride"?: boolean }
 *
 * A manual dropdown pick sets `deliveryScheduleOverride`, and the sync then
 * leaves that row alone until `clearOverride` is sent for it.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireSyncApiKey, SYNC_API_KEY_HEADER } from "@/schedular_function/auth";
import { runDeliveryScheduleSync } from "@/lib/deliveryScheduleSync";

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const raw = (await request.text()).trim();
  let body: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return badRequest("Body must be a JSON object.");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return badRequest("Body must be valid JSON.");
    }
  }

  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    return badRequest("dryRun must be a boolean.");
  }
  if (body.clearOverride !== undefined && typeof body.clearOverride !== "boolean") {
    return badRequest("clearOverride must be a boolean.");
  }
  for (const key of ["enquiryId", "docketNumber"] as const) {
    const value = body[key];
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      return badRequest(`${key} must be a non-empty string.`);
    }
  }
  const itemIds = body.itemIds;
  if (
    itemIds !== undefined &&
    (!Array.isArray(itemIds) ||
      itemIds.length === 0 ||
      itemIds.some((id) => typeof id !== "string" || id.trim() === ""))
  ) {
    return badRequest("itemIds must be a non-empty array of strings.");
  }

  try {
    const result = await runDeliveryScheduleSync({
      dryRun: body.dryRun === true,
      enquiryId: typeof body.enquiryId === "string" ? body.enquiryId.trim() : undefined,
      docketNumber:
        typeof body.docketNumber === "string" ? body.docketNumber.trim() : undefined,
      itemIds: Array.isArray(itemIds) ? (itemIds as string[]).map((id) => id.trim()) : undefined,
      clearOverride: body.clearOverride === true,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[delivery-schedule] failed: ${message}`, error);
    const status = message.includes("clearOverride requires") ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST.",
      job: "delivery-schedule",
      auth: `x-api-key header (${SYNC_API_KEY_HEADER})`,
      body: {
        dryRun: "boolean",
        enquiryId: "string",
        docketNumber: "string",
        itemIds: "string[]",
        clearOverride: "boolean (needs a scope)",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
