import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractBidResults } from "@/lib/services/gem-bid-results";

const HARDCODED_GEM_IDS = [
  "GEM/2026/B/7669772",
];

export async function GET(request: NextRequest) {
  try {
    let gemIds = HARDCODED_GEM_IDS;

    try {
      const body = await request.json();
      if (body.gemIds && Array.isArray(body.gemIds) && body.gemIds.length > 0) {
        gemIds = body.gemIds;
      }
    } catch {}

    const results = await extractBidResults(gemIds, (current, total) => {
      console.log(`Progress: ${current}/${total}`);
    });

    let updatedCount = 0;
    for (const result of results) {
      if (!result.success) continue;

      try {
        const existing = await prisma.tenderMerged.findUnique({
          where: { referenceNo: result.gemId },
          include: { evaluations: true },
        });

        if (!existing) {
          try { console.error(`TenderMerged with referenceNo ${result.gemId} not found in DB`); } catch {}
          continue;
        }

        await prisma.tenderMerged.update({
          where: { referenceNo: result.gemId },
          data: {
            bidStatus: result.bidStatus || null,
            differenceBetweenRank1: result.differenceBetweenRank1 || null,
          },
        });

        if (result.evaluations && result.evaluations.length > 0) {
          await prisma.evaluation.deleteMany({
            where: { tenderMergedId: existing.id },
          });

          await prisma.evaluation.createMany({
            data: result.evaluations.map((e) => ({
              tenderMergedId: existing.id,
              sellerName: e.sellerName,
              offeredItem: e.offeredItem,
              totalPrice: e.totalPrice,
              rank: e.rank,
              status: e.status,
            })),
          });
        }

        updatedCount++;
        try { console.log(`  DB updated for ${result.gemId}`); } catch {}
      } catch (dbErr) {
        try { console.error(`Failed to update DB for ${result.gemId}:`, dbErr); } catch {}
      }
    }

    return NextResponse.json({
      success: updatedCount,
      failed: results.length - updatedCount,
      total: results.length,
      results,
    });
  } catch (error) {
    try { console.error("Bid results error:", error); } catch {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
