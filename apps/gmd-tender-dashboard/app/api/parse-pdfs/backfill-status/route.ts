import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DRIVE_REGEX = /\/file\/d\/([^\/]+)/;

export async function POST() {
  try {
    const tenders = await prisma.tenderMerged.findMany({
      where: { parseStatus: null },
      select: { id: true, tenderFileUrl: true, itemCategory: true },
    });

    let noUrl = 0;
    let invalidUrl = 0;
    let alreadyParsed = 0;
    let skipped = 0;

    for (const t of tenders) {
      if (!t.tenderFileUrl) {
        await prisma.tenderMerged.update({
          where: { id: t.id },
          data: { parseStatus: "FAILED", parseError: "No file URL" },
        });
        noUrl++;
      } else if (!DRIVE_REGEX.test(t.tenderFileUrl)) {
        await prisma.tenderMerged.update({
          where: { id: t.id },
          data: { parseStatus: "FAILED", parseError: "Invalid Google Drive URL" },
        });
        invalidUrl++;
      } else if (t.itemCategory) {
        await prisma.tenderMerged.update({
          where: { id: t.id },
          data: { parseStatus: "COMPLETED", parseError: null },
        });
        alreadyParsed++;
      } else {
        skipped++;
      }
    }

    return NextResponse.json({
      total: tenders.length,
      noUrl,
      invalidUrl,
      alreadyParsed,
      skipped,
    });
  } catch (error) {
    console.error("Backfill status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
