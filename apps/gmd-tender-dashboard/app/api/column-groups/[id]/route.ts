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
    const { label, separator, fields } = body;

    const data: Record<string, unknown> = {};
    if (label !== undefined) data.label = label;
    if (separator !== undefined) data.separator = separator;
    if (fields !== undefined) {
      if (!Array.isArray(fields) || fields.length < 2) {
        return NextResponse.json(
          { error: "fields must be an array with at least 2 items" },
          { status: 400 },
        );
      }
      data.fields = JSON.stringify(fields);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const group = await prisma.columnGroup.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    const changedFields = Object.keys(data).join(", ");
    logActivity({
      action: "UPDATE",
      tableName: "ColumnGroup",
      recordId: String(group.id),
      details: `Updated column group #${group.id}: ${changedFields}`,
    });

    return NextResponse.json({ group });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 },
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
    const before = await prisma.columnGroup.findUnique({
      where: { id: parseInt(id, 10) },
    });
    await prisma.columnGroup.update({
      where: { id: parseInt(id, 10) },
      data: { status: "deleted" },
    });
    logActivity({
      action: "DELETE",
      tableName: "ColumnGroup",
      recordId: String(id),
      details: before
        ? `Deleted column group #${id} ("${before.label}")`
        : `Deleted column group #${id}`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
