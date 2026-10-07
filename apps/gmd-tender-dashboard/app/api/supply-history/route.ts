import { NextRequest, NextResponse } from "next/server";
import { DatabaseSupplyService } from "@/services/databaseSupplyService";
import { fetchSupplyHistoryFromGoogleSheet } from "@/services/supplySheetService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const forceFresh = req.nextUrl.searchParams.get("fresh") === "true";

  // 1. DB-first (unless force fresh)
  if (!forceFresh) {
    try {
      const dbData = await DatabaseSupplyService.getAllSupplyHistory();
      const withDocs = await DatabaseSupplyService.enrichWithDocumentStatus(dbData);
      if (withDocs && withDocs.length > 0) {
        return NextResponse.json({ success: true, data: withDocs });
      }
    } catch (err: any) {
      console.warn("[API:GET /api/supply-history] DB fetch failed:", err.message);
    }
  }

  // 2. Fetch from Google Sheets
  try {
    const records = await fetchSupplyHistoryFromGoogleSheet();
    // 3. Upsert to DB (synchronous)
    try {
      await DatabaseSupplyService.upsertSupplyHistory(records);
    } catch (err: any) {
      console.error("[API:GET /api/supply-history] DB upsert error:", err.message);
    }
    // 4. Return from DB so synced fields (e.g. quotationNo) are included
    const dbData = await DatabaseSupplyService.getAllSupplyHistory();
    const withDocs = await DatabaseSupplyService.enrichWithDocumentStatus(dbData);
    console.log(`[API:GET /api/supply-history] Fetched ${withDocs.length} records from Google Sheets`);
    return NextResponse.json({ success: true, data: withDocs });
  } catch (err: any) {
    console.error("[API:GET /api/supply-history] Google Sheets fetch failed:", err.message);

    return NextResponse.json({ success: false, error: err.message, data: [] });
  }
}
