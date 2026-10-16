import { NextRequest, NextResponse } from "next/server";
import { GoogleSheetService } from "@/services/googleSheetService";
import { DatabaseTenderService } from "@/services/databaseTenderService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const sheetService = new GoogleSheetService();
    const records = await sheetService.fetchTenderRecords();
    if (records && records.length > 0) {
      await DatabaseTenderService.upsertTenders(records as any);
    }
    return NextResponse.json({ success: true, count: records?.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
