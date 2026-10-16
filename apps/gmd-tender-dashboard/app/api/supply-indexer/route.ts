import { NextResponse } from "next/server";
import { runIndexer } from "@/services/supplyDocumentIndexer";
import { syncContractAttachments } from "@/services/contractAttachmentService";

export async function POST() {
  try {
    console.log("[API:POST /api/supply-indexer] Triggering manual index scan...");
    const [indexResult, contractResult] = await Promise.allSettled([
      runIndexer(),
      syncContractAttachments(),
    ]);

    if (indexResult.status === "fulfilled") {
      console.log("[API:POST /api/supply-indexer] Index scan completed.");
    } else {
      console.error("[API:POST /api/supply-indexer] Index scan failed:", indexResult.reason?.message);
    }

    if (contractResult.status === "fulfilled") {
      console.log("[API:POST /api/supply-indexer] Contract attachments sync:", contractResult.value);
    } else {
      console.error("[API:POST /api/supply-indexer] Contract attachments sync failed:", contractResult.reason?.message);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API:POST /api/supply-indexer] Unexpected error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
