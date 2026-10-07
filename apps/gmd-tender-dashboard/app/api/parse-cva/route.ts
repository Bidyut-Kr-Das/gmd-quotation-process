import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishTenderParsingTask } from "@/lib/queue/publisher";
import { describeTenderFile } from "@/lib/tenderFileDescriptor";

interface TenderRequest {
  id: number;
  referenceNo?: string;
  file_link: string;
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

    const tenderIds = tenders.map((t) => t.id);
    const dbTenders = await prisma.tenderMerged.findMany({
      where: { id: { in: tenderIds } },
      select: {
        id: true,
        tenderType: true,
        tenderFiles: {
          where: { tags: { has: "costingAttachment" } },
          select: { source: true, url: true },
          take: 1,
        },
      },
    });
    const typeMap = new Map(dbTenders.map((t) => [t.id, t.tenderType]));
    const costingFileMap = new Map(
      dbTenders.map((t) => [t.id, t.tenderFiles[0]]),
    );

    const gemTenders = tenders.filter((t) => typeMap.get(t.id) === "GEM");

    let queuedCount = 0;

    if (gemTenders.length > 0) {
      const publishes = gemTenders.map((t) => {
        const costingFile = costingFileMap.get(t.id);
        const { file_type, decrypted_fileId } = describeTenderFile(
          costingFile ?? { source: null, url: null },
        );
        if (!decrypted_fileId) return Promise.resolve(false);
        return publishTenderParsingTask({
          type: "COSTING_ATTACHMENT_PARSING",
          tenderId: t.id,
          referenceNo: t.referenceNo,
          file_link: t.file_link,
          file_type,
          decrypted_fileId,
          timestamp: Date.now(),
        });
      });
      const results = await Promise.all(publishes);
      queuedCount += results.filter(Boolean).length;
    }

    return NextResponse.json({
      success: true,
      queued: queuedCount,
    });
  } catch (error) {
    try {
      console.error("Parse CVA error:", error);
    } catch {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
