import { NextRequest, NextResponse } from "next/server";
import { syncCostingFromSmartsheet } from "@/services/smartsheetCostingSync";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";

export const runtime = "nodejs";

async function runSyncCosting() {
  const stats = await syncCostingFromSmartsheet();
  return stats;
}

const syncCostingWithLog = withLog(
  runSyncCosting,
  (stats) => ({
    action: "CREATE" as const,
    tableName: "CostingSheetDetails",
    details: `Costing Smartsheet ${process.env.SALES_ENQUIRY_ITEM_LIST_ERP_ID?.trim() || "2033506099089284"}: created=${stats.created} matched=${stats.matched}/${stats.totalCandidates} skippedNoName=${stats.skippedNoName} scheduleMissing=${stats.scheduleMissing} qtyMissing=${stats.qtyMissing}`,
  }),
);

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    const sheetId = process.env.SALES_ENQUIRY_ITEM_LIST_ERP_ID?.trim() || "2033506099089284";
    const stats = await syncCostingWithLog();
    return NextResponse.json({ success: true, sheetId, stats });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
