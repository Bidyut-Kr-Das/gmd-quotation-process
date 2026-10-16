import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishTenderTask } from "@/lib/queue/publisher";

interface TenderRequest {
  id: number;
  gemId?: string;
  referenceNo?: string;
  tenderStatusId?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenders } = body as { tenders: TenderRequest[] };

    if (!tenders || !Array.isArray(tenders) || tenders.length === 0) {
      return NextResponse.json(
        { error: "No tenders provided" },
        { status: 400 },
      );
    }

    // Resolve tender types from DB
    const tenderIds = tenders.map((t) => t.id);
    const dbTenders = await prisma.tenderMerged.findMany({
      where: { id: { in: tenderIds } },
      select: { id: true, tenderType: true },
    });
    const typeMap = new Map(dbTenders.map((t) => [t.id, t.tenderType]));

    const gemTenders = tenders.filter((t) => typeMap.get(t.id) === "GEM");
    const nonGemTenders = tenders.filter(
      (t) => typeMap.get(t.id) === "NON_GEM",
    );

    let queuedCount = 0;

    if (gemTenders.length > 0) {
      const gemPublishes = gemTenders.map((t) =>
        publishTenderTask({
          type: "GEM_DOWNLOAD",
          tenderId: t.id,
          gemId: t.gemId || t.referenceNo || "",
          referenceNo: t.referenceNo,
          timestamp: Date.now(),
        }),
      );
      const results = await Promise.all(gemPublishes);
      queuedCount += results.filter(Boolean).length;
    }

    if (nonGemTenders.length > 0) {
      const nonGemPublishes = nonGemTenders.map((t) =>
        publishTenderTask({
          type: "NON_GEM_DOWNLOAD",
          tenderId: t.id,
          referenceNo: t.referenceNo,
          timestamp: Date.now(),
        }),
      );
      const results = await Promise.all(nonGemPublishes);
      queuedCount += results.filter(Boolean).length;
    }

    return NextResponse.json({
      success: true,
      queued: queuedCount,
    });
  } catch (error) {
    try {
      console.error("Download PDFs error:", error);
    } catch {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
