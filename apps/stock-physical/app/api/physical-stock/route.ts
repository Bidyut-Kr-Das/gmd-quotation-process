import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COLUMNS } from "@/lib/gmd_lib/sheet-columns";
import { physicalStockRowToArray } from "@/lib/gmd_lib/sheet-row";

export async function GET() {
  const items = await prisma.physicalStock.findMany({
    orderBy: [{ form_date: "desc" }, { created_at: "desc" }],
  });
  const payload = items.map((i) => ({
    ...i,
    updatedAt: undefined,
    createdAt: undefined,
  }));
  return NextResponse.json({
    headers: COLUMNS,
    rows: items.map((i) => physicalStockRowToArray(i)),
    ids: items.map((i) => i.id),
    items: payload,
    totalRows: items.length,
  });
}