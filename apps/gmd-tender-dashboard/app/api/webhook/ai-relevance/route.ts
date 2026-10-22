import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";

interface UpdateAiRelevanceInput {
  referenceNo: string;
  valid: boolean;
  reason: string;
}

async function updateAiRelevance({
  referenceNo,
  valid,
  reason,
}: UpdateAiRelevanceInput) {
  const existing = await prisma.tenderMerged.findUnique({
    where: { referenceNo },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error(`Reference not found: ${referenceNo}`);
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  await prisma.tenderMerged.update({
    where: { id: existing.id },
    data: { aiRelevanceValid: valid, aiRelevanceReason: reason },
  });

  return { success: true, referenceNo, valid };
}

const updateAiRelevanceWithLog = withLog(
  updateAiRelevance,
  (result) => ({
    action: "UPDATE" as const,
    tableName: "TenderMerged",
    recordId: undefined,
    referenceNo: result.referenceNo,
    details: `AI relevance set valid=${result.valid} for ${result.referenceNo}`,
  }),
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = body?.data;

    const referenceNo =
      typeof data?.reference_no === "string" ? data.reference_no.trim() : "";

    if (!referenceNo) {
      return NextResponse.json(
        { error: "data.reference_no is required" },
        { status: 400 },
      );
    }

    const company = typeof data?.company === "string" ? data.company : "";
    if (company !== "laser" && company !== "gmd") {
      return NextResponse.json(
        { error: "company must be laser or gmd" },
        { status: 400 },
      );
    }

    if (data?.error != null) {
      return NextResponse.json(
        { error: "error result not supported yet" },
        { status: 400 },
      );
    }

    const result = data?.result;
    if (typeof result?.valid !== "boolean") {
      return NextResponse.json(
        { error: "data.result.valid must be a boolean" },
        { status: 400 },
      );
    }
    if (typeof result?.reason !== "string" || !result.reason.trim()) {
      return NextResponse.json(
        { error: "data.result.reason is required" },
        { status: 400 },
      );
    }

    const res = await updateAiRelevanceWithLog({
      referenceNo,
      valid: result.valid,
      reason: result.reason.trim(),
    });
    return NextResponse.json(res);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status },
    );
  }
}