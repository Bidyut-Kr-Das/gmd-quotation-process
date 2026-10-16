import { NextResponse } from "next/server";
import { syncGmdItemCodes } from "@/lib/gmdItemCodeLookup";
import { recomputeNotCurrentReqtMarks } from "@/lib/contractReviewCurrentReqt";

export async function POST() {
  try {
    const { count } = await syncGmdItemCodes();
    // The master snapshot now carries CURRENT REQT: refresh the "N" chip on the
    // contract review dashboard and the "Deleted as Current Reqt = No" mark in
    // the quotation dashboard so both track the newly synced master.
    let marks = {
      contractReview: { marked: 0, cleared: 0 },
      enquiryItem: { marked: 0, cleared: 0 },
    };
    try {
      marks = await recomputeNotCurrentReqtMarks();
    } catch (e) {
      console.warn("[gmd-item-codes sync] current reqt mark failed:", e);
    }
    return NextResponse.json({
      syncedAt: new Date().toISOString(),
      count,
      notCurrentReqtMarked: marks.contractReview.marked,
      notCurrentReqtCleared: marks.contractReview.cleared,
      notCurrentReqtEnquiryMarked: marks.enquiryItem.marked,
      notCurrentReqtEnquiryCleared: marks.enquiryItem.cleared,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
