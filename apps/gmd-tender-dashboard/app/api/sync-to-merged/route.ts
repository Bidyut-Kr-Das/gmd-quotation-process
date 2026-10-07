import { NextRequest, NextResponse } from "next/server";
import { syncSheetToTenderMerged } from "@/services/sheetToTenderMergedService";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";

async function runSyncToMerged() {
  const result = await syncSheetToTenderMerged();
  return result;
}

const syncToMergedWithLog = withLog(
  runSyncToMerged,
  (result) => {
    const { summary } = result;
    return {
      action: "UPDATE",
      tableName: "TenderMerged",
      recordId: undefined,
      details: `Sheet-to-Merged sync: ${summary.created} costing attachments created, total ${summary.total}, errors ${summary.errors}`,
    };
  },
);

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    const result = await syncToMergedWithLog();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
