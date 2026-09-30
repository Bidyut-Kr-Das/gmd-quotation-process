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
      return dbVerifyBomToRow({
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
    });

    return NextResponse.json({
      headers: VERIFY_BOM_HEADERS,
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