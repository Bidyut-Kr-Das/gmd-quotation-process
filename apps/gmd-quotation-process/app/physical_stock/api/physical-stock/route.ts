import { NextResponse } from "next/server";
import { stockPrisma } from "@/lib/stockPrisma";
import { PHYSICAL_COLUMNS } from "@/lib/gmd_lib/physical-stock-columns";
import { physicalStockRowToArray } from "@/lib/gmd_lib/physical-stock-row";
import { derivePhysicalStockByCodes } from "@/lib/gmd_lib/physical-stock-derive";

export async function GET() {
  const items = await stockPrisma.physicalStock.findMany({
    orderBy: { updated_at: "desc" },
  });

  // Per-row BOM ID dropdown options, derived from the FullItem + RawMaterial
  // BOM relations (both sides).
  const codes = [
    ...new Set(items.map((i) => (i.erp_code ?? "").trim().toUpperCase()).filter(Boolean)),
  ];
  const derivations = await derivePhysicalStockByCodes(codes);
  const bomIdOptions: Record<string, string[]> = {};
  for (const item of items) {
    const code = (item.erp_code ?? "").trim().toUpperCase();
    bomIdOptions[item.id] = derivations.get(code)?.bomIds ?? [];
  }

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
    bomIdOptions,
    totalRows: items.length,
  });
}
