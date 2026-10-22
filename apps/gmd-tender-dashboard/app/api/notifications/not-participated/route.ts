import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";
import { NOTIFICATION_TYPES, NOTIFICATION_DEADLINE_START } from "@/lib/notification-types";
import { sendNotificationMessage } from "@/lib/notifications/sender";

export const runtime = "nodejs";

const NOTIFICATION_VALUE = NOTIFICATION_TYPES.DEADLINE_OVER_NOT_PARTICIPATED;
const RECIPIENT = process.env.EVOLUTION_NOT_PARTICIPATED_NOTIFICATION_NUMBER;

async function triggerNotParticipatedNotifications() {
  const matches = await prisma.tenderMerged.findMany({
    where: {
      AND: [
        { deadline: { gt: NOTIFICATION_DEADLINE_START, lte: new Date() } },
        { apm: "YES" },
        { participated: false },
        { reason: { not: "" } },
        {
          OR: [
            { notificationStatus: null },
            { notificationStatus: { not: { contains: NOTIFICATION_VALUE } } },
          ],
        },
      ],
    },
  });

  const triggeredReferenceNos: string[] = [];
  const failedReferenceNos: string[] = [];
  const updates: ReturnType<typeof prisma.tenderMerged.update>[] = [];

  for (const tender of matches) {
    const result = await sendNotificationMessage(
      tender,
      NOTIFICATION_VALUE,
      RECIPIENT,
    );

    if (!result.success) {
      failedReferenceNos.push(tender.referenceNo);
      continue;
    }

    triggeredReferenceNos.push(tender.referenceNo);

    const existing = tender.notificationStatus;
    const nextStatus =
      existing && existing.trim().length > 0
        ? `${existing.trim()},${NOTIFICATION_VALUE}`
        : NOTIFICATION_VALUE;

    updates.push(
      prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { notificationStatus: nextStatus },
      }),
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return {
    success: true,
    triggeredCount: triggeredReferenceNos.length,
    failedCount: failedReferenceNos.length,
    total: matches.length,
    referenceNos: triggeredReferenceNos,
    failedReferenceNos,
  };
}

const triggerNotParticipatedWithLog = withLog(
  triggerNotParticipatedNotifications,
  (result) => ({
    action: "UPDATE",
    tableName: "TenderMerged",
    recordId: result.referenceNos.join(",") || undefined,
    details: `Triggered ${result.triggeredCount} not-participated notifications (${result.failedCount} failed, ${result.total} matched)`,
  }),
);

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    const result = await triggerNotParticipatedWithLog();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[notifications/not-participated] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
