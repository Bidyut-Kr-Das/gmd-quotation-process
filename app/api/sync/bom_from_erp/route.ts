import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  BOM_MAST_ERP_GID,
  readSheetTabByGid,
  requireColumns,
  cell,
} from "@/lib/gmd_lib/bomMastErp";

// Reads credentials.json / token.json from disk, so it must run on Node.
export const runtime = "nodejs";

const BATCH = 200;

const up = (s: string) => s.trim().toUpperCase();

type SheetRow = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
};

/**
 * Syncs the "BOM MAST ERP" tab into the FullItem -> Bom -> BomItem graph.
 *
 * Sheet is the source of truth for the relation:
 *   BOM_ID       -> Bom.bomId (owner = ITEM_CODE's FullItem)
 *   ITEM_CODE    -> owning FullItem.itemCode
 *   RM_ITEM_CODE -> component, RawMaterial.erpItemCode first, else
 *                   FullItem.itemCode (sub-assembly)
 *
 * Missing owning FullItems and Bom/BomItem rows are created; existing links are
 * left as-is; BomItem rows the sheet no longer backs are kept but unlinked
 * (component pointers set to null). Quantity is deliberately not synced.
 * Component codes resolving to neither table are skipped and counted.
 */
export async function POST() {
  try {
    const { tabTitle, headers, rows } = await readSheetTabByGid(
      BOM_MAST_ERP_SPREADSHEET_ID,
      BOM_MAST_ERP_GID,
    );
    const [bomIdx, itemIdx, rmIdx] = requireColumns(
      headers,
      ["BOM_ID", "ITEM_CODE", "RM_ITEM_CODE"],
      tabTitle,
    );

    // Source of truth: last sheet row wins for a given (bomId, rmItemCode).
    const byBomComponent = new Map<string, SheetRow>();
    let skippedBlankKey = 0;
    for (const row of rows) {
      const bomId = cell(row, bomIdx);
      const itemCode = cell(row, itemIdx);
      const rmItemCode = cell(row, rmIdx);
      if (!bomId || !itemCode || !rmItemCode) {
        skippedBlankKey++;
        continue;
      }
      byBomComponent.set(`${up(bomId)}||${up(rmItemCode)}`, {
        bomId,
        itemCode,
        rmItemCode,
      });
    }
    const mapped = [...byBomComponent.values()];
    const itemCodes = [...new Set(mapped.map((r) => r.itemCode))];
    const rmCodes = [...new Set(mapped.map((r) => r.rmItemCode))];

    // --- Resolve referenced codes (case-insensitive) ------------------------
    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: rmCodes, mode: "insensitive" } },
      select: { id: true, erpItemCode: true },
    });
    const rmIdByCode = new Map(
      rawMaterials
        .filter((r) => r.erpItemCode)
        .map((r) => [up(r.erpItemCode!), r.id]),
    );

    const fullItems = await prisma.fullItem.findMany({
      where: {
        itemCode: { in: [...itemCodes, ...rmCodes], mode: "insensitive" },
      },
      select: { id: true, itemCode: true },
    });
    const fiIdByCode = new Map(
      fullItems.filter((f) => f.itemCode).map((f) => [up(f.itemCode!), f.id]),
    );

    // 1. Stub owning FullItems that do not exist yet.
    let stubsCreated = 0;
    for (const itemCode of itemCodes) {
      if (fiIdByCode.has(up(itemCode))) continue;
      const fi = await prisma.fullItem.upsert({
        where: { itemCode },
        create: { itemCode },
        update: {},
        select: { id: true },
      });
      fiIdByCode.set(up(itemCode), fi.id);
      stubsCreated++;
    }

    // 2. Bom per bomId, owned by its FullItem.
    const bomIds = [...new Set(mapped.map((r) => r.bomId))];
    const existingBoms = await prisma.bom.findMany({
      where: { bomId: { in: bomIds } },
      select: { id: true, bomId: true, fullItemId: true },
    });
    const bomByCode = new Map(existingBoms.map((b) => [up(b.bomId), b]));

    const bomDbIdByCode = new Map<string, string>();
    const seenBom = new Set<string>();
    let bomCreated = 0;
    let bomOwnerUpdated = 0;
    let bomUnresolved = 0;
    for (const m of mapped) {
      const key = up(m.bomId);
      if (seenBom.has(key)) continue;
      seenBom.add(key);
      const fullItemId = fiIdByCode.get(up(m.itemCode));
      if (!fullItemId) {
        bomUnresolved++;
        continue;
      }
      const existing = bomByCode.get(key);
      const bom = await prisma.bom.upsert({
        where: { bomId: m.bomId },
        create: { bomId: m.bomId, fullItemId },
        update: { fullItemId },
        select: { id: true },
      });
      bomDbIdByCode.set(key, bom.id);
      if (!existing) bomCreated++;
      else if (existing.fullItemId !== fullItemId) bomOwnerUpdated++;
    }

    // 3. BomItem per (bom, component).
    const existingItems = await prisma.bomItem.findMany({
      where: { bomId: { in: [...bomDbIdByCode.values()] } },
      select: {
        id: true,
        bomId: true,
        rawMaterialId: true,
        fullItemId: true,
      },
    });
    const itemKey = (
      bomDbId: string,
      rawMaterialId: string | null,
      fullItemId: string | null,
    ) =>
      `${bomDbId}||${rawMaterialId ? `r:${rawMaterialId}` : `f:${fullItemId}`}`;
    const existingByKey = new Map(
      existingItems.map((i) => [
        itemKey(i.bomId, i.rawMaterialId, i.fullItemId),
        i,
      ]),
    );

    const creates: {
      bomId: string;
      rawMaterialId: string | null;
      fullItemId: string | null;
    }[] = [];
    let unresolved = 0;
    const desiredKeys = new Set<string>();

    for (const m of mapped) {
      const bomDbId = bomDbIdByCode.get(up(m.bomId));
      if (!bomDbId) continue;

      const rmId = rmIdByCode.get(up(m.rmItemCode)) ?? null;
      const fiId = rmId ? null : fiIdByCode.get(up(m.rmItemCode)) ?? null;
      if (!rmId && !fiId) {
        unresolved++;
        continue;
      }

      const key = itemKey(bomDbId, rmId, fiId);
      desiredKeys.add(key);
      if (!existingByKey.has(key)) {
        creates.push({ bomId: bomDbId, rawMaterialId: rmId, fullItemId: fiId });
      }
    }

    // DB links the sheet no longer backs — the row is kept but its component
    // pointers are cleared, so the sheet stays the source of truth.
    const staleIds = [...existingByKey.entries()]
      .filter(([k]) => !desiredKeys.has(k))
      .map(([, i]) => i.id);

    for (let i = 0; i < creates.length; i += BATCH) {
      await prisma.$transaction(
        creates
          .slice(i, i + BATCH)
          .map((c) => prisma.bomItem.create({ data: c })),
      );
    }
    for (let i = 0; i < staleIds.length; i += BATCH) {
      await prisma.bomItem.updateMany({
        where: { id: { in: staleIds.slice(i, i + BATCH) } },
        data: { rawMaterialId: null, fullItemId: null },
      });
    }

    return NextResponse.json({
      success: true,
      sheetTab: tabTitle,
      sheetRows: rows.length,
      distinctLinks: mapped.length,
      skippedBlankKey,
      stubsCreated,
      bomCreated,
      bomOwnerUpdated,
      bomUnresolved,
      linkCreated: creates.length,
      linkUnlinked: staleIds.length,
      unresolved,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error syncing BOM MAST ERP -> Bom/BomItem:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
