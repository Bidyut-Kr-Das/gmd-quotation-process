import { NextResponse } from "next/server";
import { syncPhysicalStockFromSheetAction } from "@/app/physical_stock/actions";

export async function POST() {
  const result = await syncPhysicalStockFromSheetAction();
  return NextResponse.json(result);
}
