import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { agentReportToMarkdown } from "@/lib/agent-report-markdown";

interface UpdateAgentReportInput {
  referenceNo: string;
  agentReport: string | null;
}

async function updateAgentReport({ referenceNo, agentReport }: UpdateAgentReportInput) {
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
    data: { agentReport },
  });

  return { success: true, referenceNo, agentReport };
}

const updateAgentReportWithLog = withLog(
  updateAgentReport,
  (result) => ({
    action: "UPDATE" as const,
    tableName: "TenderMerged",
    recordId: undefined,
    referenceNo: result.referenceNo,
    details: `Agent report updated: ${result.agentReport ?? "(cleared)"}`,
  }),
);

export async function PATCH(req: NextRequest) {
  try {
    const raw = await req.json();
    // Webhook envelope ({ id, event, created_at, data }) carries the report in data; flat bodies still work.
    const body = raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;
    const referenceNo =
      typeof body.referenceNo === "string"
        ? body.referenceNo.trim()
        : typeof body.tender_id === "string"
          ? body.tender_id.trim()
          : "";

    if (!referenceNo) {
      return NextResponse.json({ error: "referenceNo is required" }, { status: 400 });
    }

    const report = body.agentReport ?? (body.sections ? body : null);

    let agentReportValue: string | null = null;
    if (report != null) {
      if (typeof report === "string") {
        const trimmed = report.trim();
        if (trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed) &&
              "tender_id" in parsed &&
              "sections" in parsed
            ) {
              agentReportValue = agentReportToMarkdown(parsed as Record<string, unknown>);
            } else {
              agentReportValue = report;
            }
          } catch {
            agentReportValue = report;
          }
        } else {
          agentReportValue = report;
        }
      } else if (typeof report === "object" && !Array.isArray(report)) {
        if (!("tender_id" in report) || !("sections" in report)) {
          return NextResponse.json(
            { error: "agentReport object requires tender_id and sections" },
            { status: 400 },
          );
        }
        agentReportValue = agentReportToMarkdown(report as Record<string, unknown>);
      } else {
        return NextResponse.json(
          { error: "agentReport must be a string, object, or null" },
          { status: 400 },
        );
      }
    }

    const result = await updateAgentReportWithLog({
      referenceNo,
      agentReport: agentReportValue,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status },
    );
  }
}

export const POST = PATCH;
