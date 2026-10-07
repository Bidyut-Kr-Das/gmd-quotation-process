import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/dal";
import { withLog } from "@/lib/activity-logger";
import { NOTIFICATION_TYPES, NOTIFICATION_DEADLINE_START } from "@/lib/notification-types";
import { sendNotificationMessage } from "@/lib/notifications/sender";

export const runtime = "nodejs";

const NOTIFICATION_VALUE = NOTIFICATION_TYPES.DEADLINE_OVER_CATALOGUE_MISSING;
const RECIPIENT = process.env.EVOLUTION_CATALOGUE_MISSING_NOTIFICATION_NUMBER;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function triggerCatalogueMissingNotifications() {
  const now = new Date();
  const matches = await prisma.tenderMerged.findMany({
    where: {
      AND: [
        { tenderType: "GEM" },
        { apm: "YES" },
        { participated: null },
        { catalogueDone: "NOT_DECIDED" },
        { deadline: { gt: NOTIFICATION_DEADLINE_START, gte: now, lte: new Date(now.getTime() + SEVEN_DAYS_MS) } },
        {
          OR: [
            { notificationStatus: null },
            { notificationStatus: { not: { contains: NOTIFICATION_VALUE } } },
          ],
        },
      ],
    },
  });

  const sentReferenceNos: string[] = [];

  for (const tender of matches) {
    const result = await sendNotificationMessage(
      tender,
      NOTIFICATION_VALUE,
      RECIPIENT,
    );

    if (result.success) {
      sentReferenceNos.push(tender.referenceNo);
    }
  }

  return {
    success: true,
    sentCount: sentReferenceNos.length,
    total: matches.length,
    referenceNos: sentReferenceNos,
  };
}

const triggerCatalogueMissingWithLog = withLog(
  triggerCatalogueMissingNotifications,
  (result) => ({
    action: "UPDATE",
    tableName: "TenderMerged",
    recordId: result.referenceNos.join(",") || undefined,
    details: `Triggered ${result.sentCount} catalogue-missing notifications (${result.total} matched)`,
  }),
);

export async function POST(req: NextRequest) {
  const forbidden = await requireApiKey(req);
  if (forbidden) return forbidden;

  try {
    const result = await triggerCatalogueMissingWithLog();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[notifications/catalogue-missing] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
