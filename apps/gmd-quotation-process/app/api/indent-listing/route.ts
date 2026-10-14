import { NextResponse } from "next/server";
import { getMergedIndentListing } from "@/lib/indentListingRead";
import { prisma } from "@/lib/prisma";
import {
  RM_CODE_ITEM_CATEGORY,
  RM_CODE_VALVE_TYPES,
} from "@/lib/indentRmCodeResolver";

export const INDENT_LISTING_HEADERS = [
  "ITEM NAME",
  "SIZE",
  "PN RATING",
  "MC RECEIVED/PENDING",
  "TOTAL (BAL BILL AG CONT)",
  "V1",
  "V2",
  "V3",
  "V4",
  "V1 CATEGORY",
  "V2 CATEGORY",
  "V3 CATEGORY",
  "V4 CATEGORY",
  "RM CODE V1",
  "RM CODE V2",
  "RM CODE V3",
  "RM CODE V4",
] as const;

export async function GET() {
  try {
    const [data, rawMaterials] = await Promise.all([
      getMergedIndentListing(),
      // The same live raw-material set the resolver matches against, so the
      // hand-pick dropdown can only offer codes a sync could have picked.
      prisma.rawMaterial.findMany({
        where: {
          l8ItemCategory: {
            contains: RM_CODE_ITEM_CATEGORY,
            mode: "insensitive",
          },
          l2ValveType: {
            in: [...RM_CODE_VALVE_TYPES],
            mode: "insensitive",
          },
          newItemStatus: null,
        },
        select: { erpItemCode: true, itemNameDerived: true, itemNameAuto: true },
      }),
    ]);

    const rmOptions = rawMaterials
      .map((m) => ({
        code: (m.erpItemCode ?? "").trim(),
        name: (m.itemNameDerived ?? m.itemNameAuto ?? "").trim(),
      }))
      .filter((o) => o.code !== "")
      .sort((a, b) => a.code.localeCompare(b.code));

    return NextResponse.json({
      headers: INDENT_LISTING_HEADERS,
      ...data,
      rmOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
