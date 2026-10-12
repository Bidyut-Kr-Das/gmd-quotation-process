import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PHYSICAL_COLUMNS } from "@/lib/gmd_lib/physical-stock-columns";
import { physicalStockRowToArray } from "@/lib/gmd_lib/physical-stock-row";

export async function GET() {
  const items = await prisma.physicalStock.findMany({
    orderBy: { updated_at: "desc" },
  });
  const payload = items.map((i) => ({
    ...i,
    updated_at: undefined,
    created_at: undefined,
  }));
  return NextResponse.json({
    headers: PHYSICAL_COLUMNS,
    rows: items.map((i) => physicalStockRowToArray(i)),
    ids: items.map((i) => i.id),
    items: payload,
    totalRows: items.length,
  });
}
