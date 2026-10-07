import { prisma as tenderPrisma } from "@gmd/db-tender";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_REVIEW_HEADERS,
  dbContractReviewToRow,
} from "@/lib/gmd_lib/contract-review-columns";
import {
  getBatchDistinctBomIds,
  getBomRmAvailBatch,
  recomputeVerifyBomValues,
  computeContractReviewRmAvail,
} from "@/lib/verifyBomLookup";
import { getContractReviewImagesByItemCode } from "@/lib/gmd_lib/contract-review-image-lookup";
import { normalizeContractKey } from "@/lib/gmd_lib/contract-review-enquiry-backfill";

export async function GET() {
  try {
    await recomputeVerifyBomValues();

    const items = await tenderPrisma.contractReview.findMany({
      orderBy: { syncedAt: "desc" },
    });

    const withBom = items.filter((i) => i.bomId);
    const bomIds = [
      ...new Set(withBom.map((i) => i.bomId).filter((b): b is string => !!b)),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const noUseUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        tenderPrisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (noUseUpdates.length > 0) {
      await tenderPrisma.$transaction(noUseUpdates);
    }
    for (const item of items) {
      if (item.bomId) item.noUse = availMap.get(item.id) ?? null;
    }

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const codes = [
      ...new Set(items.map((i) => i.itemCode).filter(Boolean)),
    ];
    const bomMap = await getBatchDistinctBomIds(codes);
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) {
      bomIdOptions[item.id] = bomMap.get(item.itemCode) ?? [];
    }

    // Images are keyed by itemType/operationType/rmType, not by item code, so
    // they resolve through EnquiryItem.erpItemCode. Keyed here by the raw
    // itemCode so the client can look up with the cell value as-is.
    const imagesByNormalizedCode =
      await getContractReviewImagesByItemCode(codes);
    const itemImages: Record<
      string,
      {
        imageKey: string;
        url: string | null;
        driveFileId: string | null;
        itemType: string | null;
        operationType: string | null;
        rmType: string | null;
      }[]
    > = {};
    for (const item of items) {
      const matches =
        imagesByNormalizedCode.get(normalizeContractKey(item.itemCode)) ?? [];
      if (matches.length === 0) continue;
      itemImages[item.itemCode] = matches;
    }

    const rows = items.map(dbContractReviewToRow);

    const diagramVerdicts: Record<string, string> = {};
    for (const item of items) {
      if (item.diagramVerdict) diagramVerdicts[item.id] = item.diagramVerdict;
    }

    return NextResponse.json({
      headers: CONTRACT_REVIEW_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
      bomIdOptions,
      itemImages,
      diagramVerdicts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}