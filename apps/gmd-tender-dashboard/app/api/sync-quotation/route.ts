import { NextRequest, NextResponse } from "next/server";
import { syncQuotationFromSmartsheet } from "@/services/smartsheetQuotationSync";
import { requireAdminApi } from "@/lib/dal";

export async function POST(req: NextRequest) {
  const forbidden = await requireAdminApi()
  if (forbidden) return forbidden

  try {
    const result = await syncQuotationFromSmartsheet();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
