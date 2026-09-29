import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const items = await prisma.indentListing.findMany({
      orderBy: { item: "asc" },
    });

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const rows = items.map((item) => [
      item.item,
      item.size,
      item.pnRating,
      item.mcReceivedPending,
      item.totalBalBillAgCont != null
        ? String(item.totalBalBillAgCont)
        : null,
      item.v1,
      item.v2,
      item.v3,
      item.v4,
      item.v1Category,
      item.v2Category,
      item.v3Category,
      item.v4Category,
      item.rmCodeV1,
      item.rmCodeV2,
      item.rmCodeV3,
      item.rmCodeV4,
    ]);

    return NextResponse.json({
      headers: INDENT_LISTING_HEADERS,
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