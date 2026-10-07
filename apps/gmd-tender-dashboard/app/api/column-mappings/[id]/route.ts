import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-logger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { excelHeader, dbField, displayName } = body;

    const data: Record<string, unknown> = {};
    if (excelHeader !== undefined) data.excelHeader = excelHeader;
    if (dbField !== undefined) data.dbField = dbField;
    if (displayName !== undefined) data.displayName = displayName;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const mapping = await prisma.columnMapping.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    const changedFields = Object.keys(data).join(", ");
    logActivity({
      action: "UPDATE",
      tableName: "ColumnMapping",
      recordId: String(mapping.id),
      details: `Updated column mapping #${mapping.id}: ${changedFields}`,
    });

    return NextResponse.json({ mapping });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 },
      );
    }
    if ((error as any)?.code === "P2002") {
      return NextResponse.json(
        { error: "A mapping with this excelHeader and dbField already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const before = await prisma.columnMapping.findUnique({
      where: { id: parseInt(id, 10) },
    });
    await prisma.columnMapping.update({
      where: { id: parseInt(id, 10) },
      data: { status: "deleted" },
    });
    logActivity({
      action: "DELETE",
      tableName: "ColumnMapping",
      recordId: String(id),
      details: before
        ? `Deleted column mapping #${id} ("${before.excelHeader}" → "${before.dbField}")`
        : `Deleted column mapping #${id}`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
