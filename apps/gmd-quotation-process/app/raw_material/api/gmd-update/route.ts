import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CANONICAL_COLUMNS } from "@/lib/gmd_lib/sheet-columns";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";
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
        transferred: true,
        vendorReference: true,
        attachmentUrl: true,
        cBatch: true,
        costMerged: true,
        syncedAt: true,
      },
    });

    // RM → BOM links now live in BomItem (RawMaterial no longer carries bomId).
    const bomLinks = await prisma.bomItem.findMany({
      where: { rawMaterialId: { in: items.map((item) => item.id) } },
      select: {
        rawMaterialId: true,
        bom: { select: { bomId: true } },
      },
    });
    const bomIdsByRmId = new Map<string, string[]>();
    for (const link of bomLinks) {
      const bId = link.bom?.bomId?.trim();
      if (!link.rawMaterialId || !bId) continue;
      const arr = bomIdsByRmId.get(link.rawMaterialId) ?? [];
      if (!arr.includes(bId)) arr.push(bId);
      bomIdsByRmId.set(link.rawMaterialId, arr);
    }

    // Available BOM IDs per item code come from the FullItem → Bom relation.
    const allBoms = await prisma.bom.findMany({
      select: { bomId: true, fullItem: { select: { itemCode: true } } },
    });
    const bomIdsByCode = new Map<string, string[]>();
    for (const bom of allBoms) {
      const code = bom.fullItem?.itemCode?.trim();
      const bId = bom.bomId?.trim();
      if (!code || !bId) continue;
      const arr = bomIdsByCode.get(code) ?? [];
      if (!arr.includes(bId)) arr.push(bId);
      bomIdsByCode.set(code, arr);
    }

    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) {
      bomIdOptions[item.id] =
        bomIdsByCode.get((item.erpItemCode ?? "").trim()) ?? [];
    }

    // Newest sync wins. rows are ordered by createdAt for display, so the first
    // row is NOT necessarily the most recently synced one (skipped/closed rows
    // are never re-stamped).
    const syncedAt =
      items.length > 0
        ? items.reduce(
            (max, i) => (i.syncedAt > max ? i.syncedAt : max),
            items[0].syncedAt,
          )
        : null;
    const headers = [...CANONICAL_COLUMNS.slice(0, 2), "ITEM NAME (derived)", ...CANONICAL_COLUMNS.slice(2), "BOM ID", "Vendor Reference", "Attachment", C_BATCH_HEADER];
    const rows = items.map((i) => {
      const r = dbItemToRow({
        ...i,
        bomId: (bomIdsByRmId.get(i.id) ?? []).join(", ") || null,
        cost: i.cost != null ? Number(i.cost) : null,
      });
      return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
    });
    const ids = items.map((item) => item.id);
    const transferredIds = items
      .filter((item) => item.transferred)
      .map((item) => item.id);
    const costMergedIds = items
      .filter((item) => item.costMerged)
      .map((item) => item.id);

    return NextResponse.json({ headers, rows, ids, syncedAt, bomIdOptions, transferredIds, costMergedIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
