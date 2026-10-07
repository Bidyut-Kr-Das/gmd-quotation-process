import { NextRequest, NextResponse } from "next/server";
import { DatabaseTenderService } from "@/services/databaseTenderService";
import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";
import { DatabaseSupplyService } from "@/services/databaseSupplyService";
import { GoogleSheetService } from "@/services/googleSheetService";
import { fetchAndEnrichSmartsheetTenders } from "@/services/smartsheetEnrichmentService";
import { fetchSupplyHistoryFromGoogleSheet } from "@/services/supplySheetService";
import { requireAdminApi } from "@/lib/dal";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const forbidden = await requireAdminApi()
  if (forbidden) return forbidden
  const errors: string[] = [];

  // 1. Refresh Executive Dashboard (Tender) data
  try {
    const sheetService = new GoogleSheetService();
    const records = await sheetService.fetchTenderRecords();
    if (records && records.length > 0) {
      await DatabaseTenderService.upsertTenders(records as any);
    }
  } catch (err: any) {
    errors.push(`Tender sync failed: ${err.message}`);
    console.error("[RefreshAll] Tender sync error:", err.message);
  }

  // 2. Refresh Enquiry-to-Quotation (Smartsheet) data
  try {
    const enriched = await fetchAndEnrichSmartsheetTenders();
    if (enriched && enriched.length > 0) {
      await DatabaseSmartsheetService.upsertSmartsheetTenders(enriched);
    }
  } catch (err: any) {
    errors.push(`Smartsheet sync failed: ${err.message}`);
    console.error("[RefreshAll] Smartsheet sync error:", err.message);
  }

  // 3. Refresh Supply History data
  try {
    const records = await fetchSupplyHistoryFromGoogleSheet();
    if (records && records.length > 0) {
      await DatabaseSupplyService.upsertSupplyHistory(records);
    }
  } catch (err: any) {
    errors.push(`Supply history sync failed: ${err.message}`);
    console.error("[RefreshAll] Supply history sync error:", err.message);
  }

  if (errors.length > 0) {
    return NextResponse.json({
      success: false,
      message: "Sync completed with errors",
      errors,
    }, { status: 200 });
  }

  return NextResponse.json({ success: true, message: "All sources synced successfully!" });
}
