import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";
import { syncBomFromItemSchedule } from "@/services/bomSync";

export const runtime = "nodejs";
export const maxDuration = 300;

async function runSyncBom(params: {
  limit?: number;
  batchSize?: number;
  dryRun?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  itemNames?: string[];
}) {
  const stats = await syncBomFromItemSchedule(params);
  return stats;
}

const runSyncBomWithLog = withLog(runSyncBom, (result, params) => ({
  action: "UPDATE" as const,
  tableName: "Bom",
  details: `Bom sync: unique=${result.uniqueNames} batches=${result.batches} batchSize=${result.batchSize} apiOk=${result.apiOk} fail=${result.apiFail} records=${result.recordsReturned} upserted=${result.upserted} empty=${result.skippedEmptyResult} missingKey=${result.skippedMissingKey} failed=${result.failed}${result.dryRun ? ` dryRun wouldUpsert=${result.wouldUpsert}` : ""} limit=${params?.limit ?? "none"}`,
}));

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    let body: {
      limit?: number;
      batchSize?: number;
      dryRun?: boolean;
      verbose?: boolean;
      apiUrl?: string;
      itemNames?: string[];
    } = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // ignore malformed json, treat as empty
    }

    const params = {
      limit: body.limit != null ? Number(body.limit) : undefined,
      batchSize: body.batchSize != null ? Number(body.batchSize) : undefined,
      dryRun: body.dryRun ?? false,
      verbose: body.verbose ?? false,
      apiUrl: body.apiUrl ? String(body.apiUrl) : undefined,
      itemNames: Array.isArray(body.itemNames) ? body.itemNames.map((n) => String(n)) : undefined,
    };

    if (params.batchSize !== undefined && (isNaN(params.batchSize) || params.batchSize <= 0)) {
      return NextResponse.json({ error: "batchSize must be a positive number" }, { status: 400 });
    }
    if (params.limit !== undefined && (isNaN(params.limit) || params.limit < 0)) {
      return NextResponse.json({ error: "limit must be a non-negative number" }, { status: 400 });
    }

    const stats = await runSyncBomWithLog(params);
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
