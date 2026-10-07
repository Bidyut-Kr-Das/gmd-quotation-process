import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SUPPLY_HISTORY_HEADERS,
  dbItemToRow,
} from "@/lib/gmd_lib/supply-history-columns";
import { C_BATCH_HEADER } from "@/lib/gmd_lib/verify-bom-columns";

const DISPLAY_HEADERS = <const>[
  "INVOICE NO",
  "item name",
  "ERP ITEM CODE",

  "FINANCIAL YEAR",
  "party name",
  // "ERP PARTY NAME",
  "Date",
  "PARTY Order No.",
  "ORDER LIST",
  "PARTY Date",
  "Quantity",
  "UOM",
  "Value",
  "Gross Total- INVOICE VALUE",
  "LR NO & DT",
  "DELIVERY DESTINATION",
  "CONSIGNEE ADDRESS",
  "CONSIGNEE NAME",
  "ERP CONTRACT NO",
  "Item Type",
  "MOC",
  "Size",
  "CLASS OF VALVE",
  "SPARES (TYPE)",
  "INVOICE",
  "INSPECTION REPORT",
  "State",
  "UTILITY",
  "performance certificate",
  "service period complete",
  "WARRANTY VALID TILL AS PER CONTRACT",
  "Warranty valid/Not",
  "BG NO",
  "PBG VALID TILL",
  "as per order warranty period",
  "PBG CLAIM TILL",
  "PBG AMOUNT",
  "Warranty Exp Date as Per Inv",
  "Party Mail Address",
  C_BATCH_HEADER,
];

const displayColumnMap = DISPLAY_HEADERS.map((h) =>
  SUPPLY_HISTORY_HEADERS.indexOf(h),
);

const MERGE_FIELDS: Record<string, [string, string]> = {
  "Item Type": ["typeOfValve", "derivedItemType"],
  MOC: ["moc", "derivedMoc"],
  Size: ["sizeOfValve", "derivedSize"],
};

export async function GET() {
  try {
    const [items, utilityRows] = await Promise.all([
      prisma.supplyHistoryItem.findMany({
        orderBy: { syncedAt: "desc" },
      }),
      prisma.lookupOption.findMany({
        where: { type: "UTILITY", isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        select: { value: true },
      }),
    ]);
    const utilityOptions = utilityRows
      .map((r) => r.value)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const rows = items.map((item) => {
      const canonicalRow = dbItemToRow(item);
      const row = displayColumnMap.map((idx) => canonicalRow[idx]);
      for (const [header, [sheetField, derivedField]] of Object.entries(
        MERGE_FIELDS,
      )) {
        const idx = (DISPLAY_HEADERS as readonly string[]).indexOf(header);
        if (idx === -1) continue;
        const sheetVal = (item as any)[sheetField];
        const derivedVal = (item as any)[derivedField];
        row[idx] = sheetVal || derivedVal || null;
      }
      return row;
    });

    return NextResponse.json({
      headers: DISPLAY_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
      utilityOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
