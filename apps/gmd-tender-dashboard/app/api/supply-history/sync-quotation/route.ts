import { NextRequest, NextResponse } from "next/server";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";
import { syncContractQuotationNumbers } from "@/services/contractQuotationSyncService";
import { withLog } from "@/lib/activity-logger";

export const runtime = "nodejs";

async function runSyncQuotation() {
  const stats = await syncContractQuotationNumbers();
  return stats;
}

const syncQuotationWithLog = withLog(
  runSyncQuotation,
  (stats) => ({
    action: "UPDATE" as const,
    tableName: "SupplyHistory",
    details: `Synced quotation numbers from contract register: ${stats.updated} records updated (${stats.totalContracts} contracts, ${stats.notFound} not found, ${stats.errors.length} errors)`,
  }),
);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || null;
    TenderAttachmentController.authenticateAccess(authHeader);

    const stats = await syncQuotationWithLog();
    return NextResponse.json({ success: true, stats });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to sync quotation numbers" },
      { status: err.status || 500 },
    );
  }
}
