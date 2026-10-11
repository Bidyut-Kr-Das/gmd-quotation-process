import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  buildVerifyBomColumnMap,
  mapVerifyBomRow,
  findVerifyBomColumnIndex,
} from "@/lib/gmd_lib/verify-bom-columns";

const SPREADSHEET_ID =
  process.env.BOM_SHEET_SPREADSHEET_ID 
const SHEET_NAME = "VERIFY BOM";

function getAuth() {
  return getOAuthClient();
}

function toInt(v: string | null): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number.parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function clean(v: string | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// Reads the VERIFY BOM tab and materialises the relational chain:
// FullItem -> Bom -> BomItem -> (RawMaterial | FullItem). Each sheet row is a
// component of a BOM. Existing rows are matched by (bom, component) and their
// quantity refreshed; nothing else is clobbered.
export async function POST() {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error(
        "BOM_SHEET_SPREADSHEET_ID (or CONTRACT_SHEET_SPREADSHEET_ID) not configured",
      );
    }

    const auth = getAuth();
    const sheets = googleSheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetTitles =
      (meta.data.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t));

    if (!sheetTitles.includes(SHEET_NAME)) {
      throw new Error(`Sheet "${SHEET_NAME}" not found in the spreadsheet`);
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    if (allRows.length < 2) {
      return NextResponse.json({ count: 0, syncedAt: new Date().toISOString() });
    }

    const sheetHeaders = allRows[0].map(String);
    const columnMap = buildVerifyBomColumnMap(sheetHeaders);
    const statusIdx = findVerifyBomColumnIndex(sheetHeaders, "STATUS OF BOM");

    const rawRows = allRows
      .slice(1)
      .filter((r) => r.some((c) => c !== null && c !== ""))
      .filter((r) => {
        if (statusIdx < 0) return true;
        return String(r[statusIdx] ?? "").trim().toLowerCase() !== "closed";
      });

    const mapped = rawRows
      .map((rawRow) => mapVerifyBomRow(rawRow, columnMap, new Date()))
      .filter((m) => m.bomId && m.itemCode && m.rmItemCode);

    // Resolve all referenced codes once.
    const itemCodes = [...new Set(mapped.map((m) => m.itemCode))];
    const rmCodes = [...new Set(mapped.map((m) => m.rmItemCode))];

    // 1. FullItem per ITEM CODE (create stub; never clobber existing meta).
    for (const itemCode of itemCodes) {
      await prisma.fullItem.upsert({
        where: { itemCode },
        create: { itemCode },
        update: {},
      });
    }

    const fullItems = await prisma.fullItem.findMany({
      where: { itemCode: { in: itemCodes } },
      select: { id: true, itemCode: true },
    });
    const fullItemByCode = new Map(
      fullItems
        .filter((f) => f.itemCode)
        .map((f) => [f.itemCode!.trim(), f.id]),
    );

    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: rmCodes } },
      select: { id: true, erpItemCode: true },
    });
    const rawMaterialByCode = new Map(
      rawMaterials
        .filter((r) => r.erpItemCode)
        .map((r) => [r.erpItemCode!.trim(), r.id]),
    );

    // 2. Bom per BOM ID, owned by its FullItem.
    let upserted = 0;
    const bomIdByCode = new Map<string, string>();
    for (const m of mapped) {
      const fullItemId = fullItemByCode.get(m.itemCode.trim());
      if (!fullItemId) continue;
      if (bomIdByCode.has(m.bomId)) continue;
      const bom = await prisma.bom.upsert({
        where: { bomId: m.bomId },
        create: {
          bomId: m.bomId,
          bomIdType: clean(m.bomIdType),
          fullItemId,
        },
        update: { bomIdType: clean(m.bomIdType), fullItemId },
        select: { id: true },
      });
      bomIdByCode.set(m.bomId, bom.id);
    }

    // 3. BomItem per (bom, component). Component resolves to RawMaterial first,
    //    then FullItem. Unknown components are skipped.
    for (const m of mapped) {
      const bomDbId = bomIdByCode.get(m.bomId);
      if (!bomDbId) continue;

      const rmId = rawMaterialByCode.get(m.rmItemCode.trim());
      const fiId = rmId ? null : fullItemByCode.get(m.rmItemCode.trim());
      if (!rmId && !fiId) continue;

      const where = rmId
        ? { bomId: bomDbId, rawMaterialId: rmId }
        : { bomId: bomDbId, fullItemId: fiId! };

      const existing = await prisma.bomItem.findFirst({
        where,
        select: { id: true },
      });

      const quantity = toInt(m.bomItemQty);
      if (existing) {
        await prisma.bomItem.update({
          where: { id: existing.id },
          data: { quantity },
        });
      } else {
        await prisma.bomItem.create({
          data: { bomId: bomDbId, quantity, ...(rmId ? { rawMaterialId: rmId } : { fullItemId: fiId! }) },
        });
      }
      upserted++;
    }

    console.log(
      `Upserted ${upserted} BomItem(s) from sheet "${SHEET_NAME}"`,
    );

    return NextResponse.json({
      count: upserted,
      totalInSheet: mapped.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
