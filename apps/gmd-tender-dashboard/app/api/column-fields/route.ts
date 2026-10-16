import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const SKIP_COLS = new Set([
  "id",
  "file_id",
  "created_at",
  "updated_at",
  "tender_status_id",
  "utility_mapping_id",
]);

const TENDER_FIELDS = [
  "nameOfWorkDescription",
  "tenderSubmittedDate",
  "estimatedCostRs",
  "reason",
  "managementDecision",
  "tenderPrepareBy",
  "reverseAuctionApplicable",
  "emdPaymentMode",
  "bgNoUtrNo",
  "emdValidity",
  "bidValidityExpired",
];

export async function GET() {
  try {
    const columnRows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT DISTINCT column_name FROM information_schema.columns WHERE table_name IN ('gem_tenders', 'non_gem_tenders')`,
    );

    const allFields = new Set<string>();
    for (const row of columnRows) {
      if (!SKIP_COLS.has(row.column_name)) {
        allFields.add(snakeToCamel(row.column_name));
      }
    }

    const extraFieldRows = await prisma.tenderExtraField.findMany({
      select: { fieldName: true },
      distinct: ["fieldName"],
      where: { fieldName: { not: "" } },
    });

    for (const row of extraFieldRows) {
      allFields.add(row.fieldName);
    }

    for (const field of TENDER_FIELDS) {
      allFields.add(field);
    }

    const groupRows = await prisma.columnGroup.findMany({
      select: { label: true },
      where: { status: "active" },
    });
    for (const row of groupRows) {
      allFields.add(row.label);
    }

    const columnIndices = await prisma.columnIndex.findMany({
      where: { status: "active" },
      orderBy: { displayOrder: "asc" },
      select: { columnName: true, displayName: true, displayOrder: true, visible: true, width: true, frozen: true },
    });

    return NextResponse.json({
      fields: Array.from(allFields).sort((a, b) => a.localeCompare(b)),
      columnIndices,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
