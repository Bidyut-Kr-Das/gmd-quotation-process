import { NextResponse } from "next/server";
import { getMergedIndentListing } from "@/lib/indentListingRead";

export const INDENT_LISTING_HEADERS = [
  "ITEM NAME",
  "SIZE",
  "PN RATING",
  "MC RECEIVED/PENDING",
  "TOTAL (BAL BILL AG CONT)",
  "V1",
  "V2",
  "V3",
  "V4",
  "V1 CATEGORY",
  "V2 CATEGORY",
  "V3 CATEGORY",
  "V4 CATEGORY",
  "RM CODE V1",
  "RM CODE V2",
  "RM CODE V3",
  "RM CODE V4",
] as const;

export async function GET() {
  try {
    const data = await getMergedIndentListing();
    return NextResponse.json({
      headers: INDENT_LISTING_HEADERS,
      ...data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
