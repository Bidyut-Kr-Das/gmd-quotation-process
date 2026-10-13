import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SUPPLY_HISTORY_HEADERS,
  dbItemToRow,
} from "@/lib/gmd_lib/supply-history-columns";
import { C_BATCH_HEADER } from "@/lib/gmd_lib/verify-bom-columns";
import { compareBomIdsDescending } from "@/lib/supplyHistoryBomSync";

const BOM_ID_HEADER = "BOM ID";
const BOM_COST_HEADER = "BOM COST";
const RAW_MATERIAL_COST_HEADER = "RAWMATERIAL COST";

const DISPLAY_HEADERS = <const>[
  "INVOICE NO",
  "item name",
  "ERP ITEM CODE",
  BOM_ID_HEADER,
  BOM_COST_HEADER,
  RAW_MATERIAL_COST_HEADER,

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
  (SUPPLY_HISTORY_HEADERS as readonly string[]).indexOf(h),
);

const MERGE_FIELDS: Record<string, [string, string]> = {
  "Item Type": ["typeOfValve", "derivedItemType"],
  MOC: ["moc", "derivedMoc"],
  Size: ["sizeOfValve", "derivedSize"],
};

function formatCost(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

export async function GET() {
  try {
    const [items, utilityRows] = await Promise.all([
      prisma.supplyHistoryItem.findMany({
        orderBy: { syncedAt: "desc" },
        include: {
          bomLinks: {
            select: {
              bomItemId: true,
              bom: { select: { bomId: true } },
              bomItem: { select: { cost: true } },
              rawMaterial: { select: { cost: true } },
            },
          },
          selectedBomItem: {
            select: {
              id: true,
              cost: true,
              bom: { select: { bomId: true } },
              rawMaterial: { select: { cost: true } },
            },
          },
        },
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

    const bomIdOptions: Record<string, string[]> = {};

    const rows = items.map((item) => {
      const canonicalRow = dbItemToRow(item);
      const row = displayColumnMap.map((idx) => canonicalRow[idx]);
      for (const [header, [sheetField, derivedField]] of Object.entries(
        MERGE_FIELDS,
      )) {
        const idx = (DISPLAY_HEADERS as readonly string[]).indexOf(header);
        if (idx === -1) continue;
        const record = item as Record<string, unknown>;
        const sheetVal = record[sheetField];
        const derivedVal = record[derivedField];
        row[idx] = sheetVal || derivedVal || null;
      }

      // Distinct BOM IDs for the dropdown, highest first.
      const options = [
        ...new Set(
          item.bomLinks
            .map((l) => l.bom?.bomId?.trim())
            .filter((v): v is string => !!v),
        ),
      ].sort(compareBomIdsDescending);
      bomIdOptions[item.id] = options;

      // Selected = remembered choice if it is still linked, else the highest BOM.
      let selectedLink = item.selectedBomItem
        ? item.bomLinks.find((l) => l.bomItemId === item.selectedBomItem!.id)
        : undefined;
      if (!selectedLink && options.length > 0) {
        selectedLink = item.bomLinks.find(
          (l) => l.bom?.bomId?.trim() === options[0],
        );
      }

      const bomIdIdx = (DISPLAY_HEADERS as readonly string[]).indexOf(
        BOM_ID_HEADER,
      );
      const bomCostIdx = (DISPLAY_HEADERS as readonly string[]).indexOf(
        BOM_COST_HEADER,
      );
      const rmCostIdx = (DISPLAY_HEADERS as readonly string[]).indexOf(
        RAW_MATERIAL_COST_HEADER,
      );

      row[bomIdIdx] = selectedLink?.bom?.bomId?.trim() || null;
      row[bomCostIdx] = selectedLink?.bomItem?.cost != null
        ? formatCost(selectedLink.bomItem.cost)
        : null;
      row[rmCostIdx] = selectedLink?.rawMaterial?.cost != null
        ? formatCost(selectedLink.rawMaterial.cost)
        : null;

      return row;
    });

    return NextResponse.json({
      headers: DISPLAY_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
      utilityOptions,
      bomIdOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
