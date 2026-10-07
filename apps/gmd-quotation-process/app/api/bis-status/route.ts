import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BIS_STATUS_HEADERS,
  dbBisStatusToRow,
} from "@/lib/gmd_lib/bis-status-columns";

export async function GET() {
  try {
    const items = await prisma.bisStatus.findMany({
      orderBy: { updatedAt: "desc" },
    });

    const lastSynced = items.length > 0
      ? items.reduce(
          (latest: Date, item) =>
            item.updatedAt > latest ? item.updatedAt : latest,
          items[0].updatedAt,
        )
      : null;

    const rows = items.map(dbBisStatusToRow);

    return NextResponse.json({
      headers: BIS_STATUS_HEADERS,
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
