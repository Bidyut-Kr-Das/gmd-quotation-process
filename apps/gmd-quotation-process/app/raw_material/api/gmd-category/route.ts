import { NextResponse } from "next/server";
import { fetchGMDCategorySheet } from "@/lib/gmd_lib/google-sheets";

export async function GET() {
  try {
    const data = await fetchGMDCategorySheet();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}
