import { NextRequest, NextResponse } from "next/server";
import { syncDocketFromSmartsheet } from "@/services/smartsheetDocketSync";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";

async function runSyncDockets() {
  const stats = await syncDocketFromSmartsheet();
  return stats;
}

const syncDocketsWithLog = withLog(
  runSyncDockets,
  (stats) => ({
    action: "UPDATE",
    tableName: "TenderMerged",
    recordId: stats.updates.map((u) => u.referenceNo).join(",") || undefined,
    details: `Synced docketNo from Smartsheet: ${stats.foundInEmailSubject + stats.foundInEnquiryTender} updated (${stats.notFound} not found, ${stats.errors} errors, ${stats.totalBlank} blank total)`,
  }),
);

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    const stats = await syncDocketsWithLog();
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
