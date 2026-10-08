import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PARTY_LOOKUP_TYPE } from "@/lib/docketPending";

export const dynamic = "force-dynamic";

const schema = z.object({
  threadId: z.string().min(1, "threadId is required"),
  partyName: z.string().min(1, "partyName is required"),
  created: z.boolean({ message: "created must be true or false" }),
  docketNo: z.string().min(1).optional(),
});

function closeMatches(input: string, values: string[]): string[] {
  const q = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return [];
  return values
    .map((v) => {
      const t = v.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!t) return { v, score: 0 };
      if (t === q) return { v, score: 3 };
      if (t.startsWith(q) || q.startsWith(t)) return { v, score: 2 };
      if (t.includes(q) || q.includes(t)) return { v, score: 1 };
      return { v, score: 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.v);
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const { threadId, partyName, created, docketNo } = parsed.data;

    const thread = await prisma.docketQuotationThread.findUnique({
      where: { threadId },
      select: { id: true, threadId: true, docketNo: true, partyName: true },
    });
    if (!thread) {
      return NextResponse.json(
        { error: `No docket quotation thread found for threadId "${threadId}".` },
        { status: 404 }
      );
    }

    const partyRows = await prisma.lookupOption.findMany({
      where: { type: PARTY_LOOKUP_TYPE, isActive: true },
      select: { value: true },
    });
    const partyValues = partyRows.map((r) => r.value);
    const trimmedParty = partyName.trim();
    const canonicalParty = partyValues.find(
      (v) => v.trim().toLowerCase() === trimmedParty.toLowerCase()
    );
    if (!canonicalParty) {
      return NextResponse.json(
        {
          error: `Party name "${trimmedParty}" is not an active PARTY lookup option.`,
          didYouMean: closeMatches(trimmedParty, partyValues),
        },
        { status: 400 }
      );
    }

    const requestedDocketNo = docketNo?.trim() || null;
    if (created && requestedDocketNo && requestedDocketNo !== thread.docketNo) {
      const existingEnquiry = await prisma.enquiry.findUnique({
        where: { docketNumber: requestedDocketNo },
        select: { id: true },
      });
      if (existingEnquiry) {
        return NextResponse.json(
          {
            error: `Docket number "${requestedDocketNo}" already belongs to an enquiry.`,
            docketNumber: requestedDocketNo,
          },
          { status: 422 }
        );
      }
    }

    const nextDocketNo = created
      ? requestedDocketNo || thread.docketNo || null
      : thread.docketNo;

    const updated = await prisma.docketQuotationThread.update({
      where: { threadId },
      data: {
        pendingDocket: created,
        partyName: canonicalParty,
        docketNo: nextDocketNo,
      },
      select: {
        id: true,
        threadId: true,
        pendingDocket: true,
        partyName: true,
        docketNo: true,
      },
    });

    return NextResponse.json({
      success: true,
      threadId: updated.threadId,
      pendingDocket: updated.pendingDocket,
      partyName: updated.partyName,
      docketNo: updated.docketNo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in POST /api/docket/automatic_create:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}