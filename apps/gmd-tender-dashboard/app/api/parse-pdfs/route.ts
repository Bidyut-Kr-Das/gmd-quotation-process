import { NextRequest, NextResponse } from "next/server";
import { extractPdfData } from "@/lib/services/pdf-extractor";
import pLimit from "p-limit";

const CONCURRENCY = 1;
const RATE_LIMIT_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenders } = body as {
      tenders: { id: number }[];
    };

    if (!tenders || !Array.isArray(tenders) || tenders.length === 0) {
      return NextResponse.json(
        { error: "No tenders provided" },
        { status: 400 },
      );
    }

    const limit = pLimit(CONCURRENCY);
    const results = await Promise.all(
      tenders.map((t, i) =>
        limit(async () => {
          if (i > 0) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
          try {
            const result = await extractPdfData(t.id);
            return { id: t.id, ...result };
          } catch {
            return { id: t.id, success: false as const, error: "unknown" };
          }
        }),
      ),
    );

    const successCount = results.filter((r) => r.success).length;

    try {
      console.log(
        `PDF Parse batch complete: ${successCount}/${results.length} succeeded`,
      );
    } catch {}

    // If any rate limited, return 429 so UI knows to back off
    const hasRateLimit = results.some(
      (r) => !r.success && (r as any).error === "rate_limit",
    );

    return NextResponse.json(
      {
        success: successCount,
        failed: results.length - successCount,
        total: results.length,
        results,
      },
      hasRateLimit ? { status: 429 } : undefined,
    );
  } catch (error) {
    try {
      console.error("Parse PDFs error:", error);
    } catch {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
