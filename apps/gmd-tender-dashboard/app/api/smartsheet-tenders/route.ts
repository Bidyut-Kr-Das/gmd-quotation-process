import { NextRequest, NextResponse } from "next/server";
import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";
import { fetchAndEnrichSmartsheetTenders } from "@/services/smartsheetEnrichmentService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const forceFresh = req.nextUrl.searchParams.get("fresh") === "true";

  // 1. DB-first (unless force fresh)
  if (!forceFresh) {
    try {
      const dbData = await DatabaseSmartsheetService.getAllSmartsheetTenders();
      if (dbData && dbData.length > 0) {
        return NextResponse.json({ success: true, data: dbData });
      }
    } catch (err: any) {
      console.warn("[API:GET /api/smartsheet-tenders] DB fetch failed:", err.message);
    }
  }

  // 2. Fetch + enrich from Smartsheet
  try {
    const enriched = await fetchAndEnrichSmartsheetTenders();
    // 3. Upsert to DB (fire-and-forget)
    DatabaseSmartsheetService.upsertSmartsheetTenders(enriched).catch((err: any) =>
      console.error("[API:GET /api/smartsheet-tenders] DB upsert error:", err.message)
    );
    return NextResponse.json({ success: true, data: enriched });
  } catch (err: any) {
    console.warn("[API:GET /api/smartsheet-tenders] Enrichment error:", err.message);
    // Fallback to basic records
    const { fetchSmartsheetTenders } = await import("@/services/tender.service");
    const basic = await fetchSmartsheetTenders();
    return NextResponse.json({ success: true, data: basic });
  }
}
