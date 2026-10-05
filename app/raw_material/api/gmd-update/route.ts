import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CANONICAL_COLUMNS } from "@/lib/gmd_lib/sheet-columns";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";
import { C_BATCH_HEADER } from "@/lib/gmd_lib/verify-bom-columns";

export async function GET() {
  try {
    const items = await prisma.rawMaterial.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        erpItemCode: true,
        itemNameAuto: true,
        itemNameDerived: true,
        l1: true,
        l2ValveType: true,
        l3Dia: true,
        l7Dimension: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
        l8ItemCategory: true,
        um: true,
        conv1: true,
        pcsWgt: true,
        aum: true,
        availableStock: true,
        cost: true,
        usdRateOption: true,
        hsnCode: true,
        hsnCodeValidation: true,
        conv2: true,
        majorMarking: true,
        newItemStatus: true,
        currentStatus: true,
        rmType: true,
        indianImported: true,
        orderDelivery: true,
        bomId: true,
        transferred: true,
        vendorReference: true,
        attachmentUrl: true,
        cBatch: true,
        syncedAt: true,
      },
    });

    const codes = [
      ...new Set(
        items
          .map((item) => item.erpItemCode)
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    const bomMap = await getBatchDistinctBomIds(codes);
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) {
      bomIdOptions[item.id] = bomMap.get(item.erpItemCode ?? "") ?? [];
    }

    const syncedAt = items.length > 0 ? items[0].syncedAt : null;
    const headers = [...CANONICAL_COLUMNS.slice(0, 2), "ITEM NAME (derived)", ...CANONICAL_COLUMNS.slice(2), "BOM ID", "Vendor Reference", "Attachment", C_BATCH_HEADER];
    const rows = items.map((i) => {
      const r = dbItemToRow({ ...i, cost: i.cost != null ? Number(i.cost) : null });
      return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
    });
    const ids = items.map((item) => item.id);
    const transferredIds = items
      .filter((item) => item.transferred)
      .map((item) => item.id);

    return NextResponse.json({ headers, rows, ids, syncedAt, bomIdOptions, transferredIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
