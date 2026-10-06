import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VERIFY_BOM_HEADERS,
  dbVerifyBomToRow,
} from "@/lib/gmd_lib/verify-bom-columns";
import {
  recomputeVerifyBomValues,
  present,
} from "@/lib/verifyBomLookup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { stockMap, rmNameMap, itemNameMap, costMap } =
      await recomputeVerifyBomValues();

    const items = await prisma.verifyBom.findMany({
      orderBy: { syncedAt: "desc" },
    });

    // BOM COST is the BOM total written onto every BomItem of the BOM by the
    // cost triggers (see prisma/seed.sql): a BOM's cost is the sum of its
    // components, and all BomItems of a BOM carry that same total. Take the
    // value directly per BOM ID instead of summing the rows.
    const bomItems = await prisma.bomItem.findMany({
      select: { cost: true, bom: { select: { bomId: true } } },
    });
    const bomCostMap = new Map<string, number>();
    for (const bi of bomItems) {
      if (bi.cost == null) continue;
      const bId = bi.bom.bomId.trim();
      const c = Number(bi.cost);
      const prev = bomCostMap.get(bId);
      bomCostMap.set(bId, prev === undefined ? c : Math.max(prev, c));
    }

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const rows = items.map((item) => {
      const rmKey = (item.rmItemCode ?? "").trim().toUpperCase();
      const liveStock = rmKey ? stockMap.get(rmKey) : undefined;
      // Prefer the live GMDUpdateItem value, else keep whatever is already
      // stored on VerifyBom so the Sync Missing Stock write is not discarded.
      const availableStock =
        (liveStock !== undefined && liveStock !== "" ? liveStock : null) ??
        item.availableStock ??
        "";
      const row = dbVerifyBomToRow({
        ...item,
        noUse: item.noUse ?? "",
        availableStock,
        cost: (item.id ? costMap.get(item.id) : null) ?? item.cost ?? "",
        // Same precedence as recomputeVerifyBomValues, or the grid would show
        // a different name than the one on the row. Previously this had no
        // fallback at all, so any rmItemCode absent from GMDUpdateItem
        // rendered blank despite a good value being stored.
        rmItemName: rmKey
          ? (present(item.rmItemName) ?? rmNameMap.get(rmKey) ?? null)
          : null,
        itemName: item.itemCode
          ? (present(item.itemName) ?? itemNameMap.get(item.itemCode) ?? null)
          : null,
      });
      const key = item.bomId.trim();
      const total = bomCostMap.get(key);
      return [
        ...row,
        total === undefined ? "" : String(Math.round(total * 100) / 100),
      ];
    });

    return NextResponse.json({
      headers: [...VERIFY_BOM_HEADERS, "BOM COST"],
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}