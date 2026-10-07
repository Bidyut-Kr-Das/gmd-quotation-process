import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { withLog } from "@/lib/activity-logger";

export interface WebhookEvent {
  id: string;
  event: string;
  created_at: string;
  data: {
    type: string;
    referenceNo: string;
    result: unknown;
    error: unknown;
  };
}

type EventHandler = (evt: WebhookEvent) => Promise<Record<string, unknown>>;

// Builds a POST handler for workers that report back with the shared event envelope.
// Without onEvent the event is only logged.
export function createWebhookHandler(source: string, onEvent?: EventHandler) {
  async function receiveEvent(evt: WebhookEvent) {
    const handled = onEvent ? await onEvent(evt) : {};
    return { success: true, id: evt.id, event: evt.event, referenceNo: evt.data.referenceNo, ...handled };
  }

  const receiveEventWithLog = withLog(receiveEvent, (result, evt) => ({
    action: "UPDATE" as const,
    tableName: "TenderMerged",
    referenceNo: evt.data.referenceNo,
    details: `${source} webhook ${evt.event} (${evt.data.type}) id=${evt.id}${
      evt.data.error ? ` error=${JSON.stringify(evt.data.error)}` : ""
    }${onEvent ? ` result=${JSON.stringify(result)}` : ""}`,
    // Public webhook — no auth session, so label the actor explicitly.
    userId: null,
    userName: `${source} Agent`,
    userEmail: "ai-agent@laserpower.in",
  }));

  return async function POST(req: NextRequest) {
    try {
      const body = await req.json();
      const data = body?.data;

      if (typeof body?.id !== "string" || !body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      if (typeof body.event !== "string" || !body.event) {
        return NextResponse.json({ error: "event is required" }, { status: 400 });
      }
      if (!data || typeof data !== "object") {
        return NextResponse.json({ error: "data is required" }, { status: 400 });
      }
      if (typeof data.type !== "string" || !data.type) {
        return NextResponse.json({ error: "data.type is required" }, { status: 400 });
      }
      const referenceNo = typeof data.referenceNo === "string" ? data.referenceNo.trim() : "";
      if (!referenceNo) {
        return NextResponse.json({ error: "data.referenceNo is required" }, { status: 400 });
      }

      const result = await receiveEventWithLog({
        id: body.id,
        event: body.event,
        created_at: typeof body.created_at === "string" ? body.created_at : "",
        data: { type: data.type, referenceNo, result: data.result ?? null, error: data.error ?? null },
      });
      return NextResponse.json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status ?? 500;
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Internal server error" },
        { status },
      );
    }
  };
}
