import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-logger";

export async function GET() {
  try {
    const mappings = await prisma.columnMapping.findMany({
      where: { status: "active" },
      orderBy: { dbField: "asc" },
    });
    return NextResponse.json({ mappings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { excelHeader, dbField, displayName } = body;

    if (!excelHeader || !dbField) {
      return NextResponse.json(
        { error: "excelHeader and dbField are required" },
        { status: 400 },
      );
    }

    const mapping = await prisma.columnMapping.create({
      data: { excelHeader, dbField, displayName: displayName || null },
    });

    logActivity({
      action: "CREATE",
      tableName: "ColumnMapping",
      recordId: String(mapping.id),
      details: `Created column mapping "${excelHeader}" → "${dbField}"`,
    });

    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
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
