import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const feedback = await prisma.aiFeedback.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(feedback);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenderId, tenderType, briefText, originalAi, correctedAi, feedbackReason } = body;

    if (!tenderId || !tenderType || !briefText || !originalAi || !correctedAi || !feedbackReason) {
      console.log({
        tenderId,
        tenderType,
        briefText,
        originalAi,
        correctedAi,
        feedbackReason
      })
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const feedback = await prisma.aiFeedback.upsert({
      where: {
        tenderId_tenderType: {
          tenderId: Number(tenderId),
          tenderType: String(tenderType),
        },
      },
      update: {
        correctedAi,
        feedbackReason,
        briefText,
        originalAi,
      },
      create: {
        tenderId: Number(tenderId),
        tenderType: String(tenderType),
        briefText: String(briefText),
        originalAi: String(originalAi),
        correctedAi: String(correctedAi),
        feedbackReason: String(feedbackReason),
      },
    });

    return NextResponse.json(feedback);
  } catch(error) {
    console.error(error)
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenderId = searchParams.get("tenderId");
    const tenderType = searchParams.get("tenderType");

    if (!tenderId || !tenderType) {
      return NextResponse.json(
        { error: "Missing tenderId or tenderType" },
        { status: 400 },
      );
    }

    await prisma.aiFeedback.delete({
      where: {
        tenderId_tenderType: {
          tenderId: Number(tenderId),
          tenderType: String(tenderType),
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete feedback" },
      { status: 500 },
    );
  }
}
