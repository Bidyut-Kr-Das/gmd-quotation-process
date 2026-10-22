import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function updateCostingBom(params: { costingId: number; bomType: string | null; bomCode: string | null }) {
  const { costingId, bomType, bomCode } = params;
  if (!costingId || Number.isNaN(costingId)) throw Object.assign(new Error("Invalid costing id"), { status: 400 });

  const existing = await prisma.costingSheetDetails.findUnique({ where: { id: costingId } });
  if (!existing) throw Object.assign(new Error("CostingSheetDetails not found"), { status: 404 });

  // normalize empty strings to null
  const normalizedBomType = bomType != null && String(bomType).trim() !== "" ? String(bomType).trim() : null;
  const normalizedBomCode = bomCode != null && String(bomCode).trim() !== "" ? String(bomCode).trim() : null;

  // if bomCode provided, optionally validate it exists for bomType/item? skip strict validation to allow manual

  const updated = await prisma.costingSheetDetails.update({
    where: { id: costingId },
    data: {
      bomType: normalizedBomType,
      bomCode: normalizedBomCode,
    },
  });

  return { updated, previousBomType: existing.bomType, previousBomCode: existing.bomCode };
}

const updateCostingBomWithLog = withLog(updateCostingBom, (result, params) => ({
  action: "UPDATE" as const,
  tableName: "CostingSheetDetails",
  recordId: String(params.costingId),
  details: `Updated bomType/bomCode on CostingSheetDetails ${params.costingId}: bomType "${result.previousBomType ?? ""}" -> "${result.updated.bomType ?? ""}", bomCode "${result.previousBomCode ?? ""}" -> "${result.updated.bomCode ?? ""}"`,
}));

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const costingId = Number(id);
    const body = await req.json().catch(() => ({}));

    const bomType = body.bomType !== undefined ? body.bomType : undefined;
    const bomCode = body.bomCode !== undefined ? body.bomCode : undefined;

    // allow partial updates: if only one provided, keep the other from existing
    // we pass null if explicitly null/empty to clear
    const payload: { bomType?: string | null; bomCode?: string | null } = {};
    if (bomType !== undefined) payload.bomType = bomType as string | null;
    if (bomCode !== undefined) payload.bomCode = bomCode as string | null;

    // If payload empty, error
    if (payload.bomType === undefined && payload.bomCode === undefined) {
      return NextResponse.json({ error: "bomType or bomCode required" }, { status: 400 });
    }

    // For missing fields, fetch existing to preserve? Our update function will set null if not provided? We want partial.
    // So we need to fill missing from existing
    const existing = await prisma.costingSheetDetails.findUnique({ where: { id: costingId }, select: { bomType: true, bomCode: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const finalBomType = payload.bomType !== undefined ? payload.bomType : existing.bomType;
    const finalBomCode = payload.bomCode !== undefined ? payload.bomCode : existing.bomCode;

    const result = await updateCostingBomWithLog({ costingId, bomType: finalBomType as string | null, bomCode: finalBomCode as string | null });
    return NextResponse.json({ success: true, data: result.updated });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message || "Failed to update" }, { status });
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const costingId = Number(id);
    const row = await prisma.costingSheetDetails.findUnique({ where: { id: costingId } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
  }
}
