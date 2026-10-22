import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { columnName, displayOrder, displayName, visible, width, frozen } = body;

    const data: Record<string, unknown> = {};
    if (columnName !== undefined) data.columnName = columnName;
    if (displayOrder !== undefined) data.displayOrder = displayOrder;
    if (displayName !== undefined) data.displayName = displayName;
    if (visible !== undefined) data.visible = visible;
    if (width !== undefined) data.width = width;
    if (frozen !== undefined) data.frozen = frozen;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const index = await prisma.columnIndex.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    return NextResponse.json({ index });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Column index not found" },
        { status: 404 },
      );
    }
    if ((error as any)?.code === "P2002") {
      return NextResponse.json(
        { error: "A column index with this columnName already exists" },
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
    await prisma.columnIndex.update({
      where: { id: parseInt(id, 10) },
      data: { status: "deleted" },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as any)?.code === "P2025") {
      return NextResponse.json(
        { error: "Column index not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
