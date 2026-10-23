import { prisma } from "@/lib/prisma";

/**
 * Rebuilds `SupplyHistoryBomLink` for every Supply History row that has an
 * `erpItemCode`, resolving the raw material through:
 *
 *   SupplyHistoryItem.erpItemCode
 *     -> RawMaterial.erpItemCode
 *     -> BomItem.rawMaterialId
 *     -> Bom
 *
 * A raw material can appear in many BOMs, so a Supply History row can hold
 * several links. All of them are kept (the UI shows them in a dropdown); only
 * `selectedBomItemId` — the remembered/default choice — is a single value.
 *
 * Link rows are rebuilt idempotently: stale links are deleted, missing links are
 * created. A user's existing `selectedBomItemId` is preserved while it is still
 * a valid link; otherwise it falls back to the highest BOM ID (natural order,
 * so `BOM-11 > BOM-9`), or is cleared when the row has no links at all.
 */

export type SupplyHistoryBomSyncResult = {
  itemsScanned: number;
  /** Items that resolved to at least one BOM link. */
  itemsWithLinks: number;
  linksCreated: number;
  linksRemoved: number;
  selectionsKept: number;
  selectionsDefaulted: number;
  selectionsCleared: number;
  /** Distinct `erpItemCode` values with no matching RawMaterial / BomItem. */
  unmatchedItemCodes: number;
};

/** Natural descending order for human BOM IDs: `BOM-11` ranks above `BOM-9`. */
import { compareBomIdsDescending } from "./bomOrder";
export { compareBomIdsDescending };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Item codes arrive from different sources (Supply History sheet, Raw Material
 * sheet) with inconsistent case and whitespace. Normalise both sides before
 * matching so `rm-001` and `RM-001` are the same material.
 */
function normCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

type Candidate = { bomItemId: string; bomDbId: string; bomId: string };

export async function rebuildSupplyHistoryBomLinks(): Promise<SupplyHistoryBomSyncResult> {
  const items = await prisma.supplyHistoryItem.findMany({
    select: { id: true, erpItemCode: true, selectedBomItemId: true },
  });

  const codeToItemIds = new Map<string, string[]>();
  for (const item of items) {
    const code = normCode(item.erpItemCode);
    if (!code) continue;
    const ids = codeToItemIds.get(code) ?? [];
    ids.push(item.id);
    codeToItemIds.set(code, ids);
  }

  const codes = [...codeToItemIds.keys()];
  const rawMaterials = codes.length
    ? await prisma.rawMaterial.findMany({
        where: { erpItemCode: { in: codes, mode: "insensitive" } },
        select: { id: true, erpItemCode: true },
      })
    : [];

  const codeToRmId = new Map<string, string>();
  for (const rm of rawMaterials) {
    const code = normCode(rm.erpItemCode);
    if (code) codeToRmId.set(code, rm.id);
  }

  const rmIds = [...codeToRmId.values()];
  const bomItems = rmIds.length
    ? await prisma.bomItem.findMany({
        where: { rawMaterialId: { in: rmIds } },
        select: {
          id: true,
          rawMaterialId: true,
          bom: { select: { id: true, bomId: true } },
        },
      })
    : [];

  const rmIdToCandidates = new Map<string, Candidate[]>();
  for (const bi of bomItems) {
    if (!bi.rawMaterialId || !bi.bom) continue;
    const bomId = bi.bom.bomId?.trim();
    if (!bomId) continue;
    const list = rmIdToCandidates.get(bi.rawMaterialId) ?? [];
    list.push({ bomItemId: bi.id, bomDbId: bi.bom.id, bomId });
    rmIdToCandidates.set(bi.rawMaterialId, list);
  }

  const desired = new Map<
    string,
    {
      supplyHistoryItemId: string;
      bomId: string;
      bomItemId: string;
      rawMaterialId: string | null;
    }
  >();
  const candidatesByItem = new Map<string, Candidate[]>();
  let unmatchedItemCodes = 0;

  for (const [code, itemIds] of codeToItemIds) {
    const rmId = codeToRmId.get(code);
    const candidates = rmId ? rmIdToCandidates.get(rmId) ?? [] : [];
    if (candidates.length === 0) {
      unmatchedItemCodes++;
      continue;
    }
    for (const itemId of itemIds) {
      candidatesByItem.set(itemId, candidates);
      for (const c of candidates) {
        desired.set(`${itemId}|${c.bomItemId}`, {
          supplyHistoryItemId: itemId,
          bomId: c.bomDbId,
          bomItemId: c.bomItemId,
          rawMaterialId: rmId ?? null,
        });
      }
    }
  }

  const existingLinks = await prisma.supplyHistoryBomLink.findMany({
    select: { id: true, supplyHistoryItemId: true, bomItemId: true },
  });

  const existingKeys = new Set<string>();
  const toDeleteIds: string[] = [];
  for (const link of existingLinks) {
    const key = `${link.supplyHistoryItemId}|${link.bomItemId}`;
    if (desired.has(key)) existingKeys.add(key);
    else toDeleteIds.push(link.id);
  }

  let linksRemoved = 0;
  for (const ids of chunk(toDeleteIds, 500)) {
    const res = await prisma.supplyHistoryBomLink.deleteMany({
      where: { id: { in: ids } },
    });
    linksRemoved += res.count;
  }

  const toCreate = [...desired.entries()]
    .filter(([key]) => !existingKeys.has(key))
    .map(([, v]) => v);

  let linksCreated = 0;
  for (const rows of chunk(toCreate, 500)) {
    const res = await prisma.supplyHistoryBomLink.createMany({
      data: rows,
      skipDuplicates: true,
    });
    linksCreated += res.count;
  }

  let selectionsKept = 0;
  let selectionsDefaulted = 0;
  let selectionsCleared = 0;
  const targetByBomItemId = new Map<string, string[]>();
  const clearIds: string[] = [];

  for (const item of items) {
    const candidates = candidatesByItem.get(item.id) ?? [];
    if (candidates.length === 0) {
      if (item.selectedBomItemId) clearIds.push(item.id);
      continue;
    }
    if (
      item.selectedBomItemId &&
      candidates.some((c) => c.bomItemId === item.selectedBomItemId)
    ) {
      selectionsKept++;
      continue;
    }
    const highest = [...candidates].sort((a, b) =>
      compareBomIdsDescending(a.bomId, b.bomId),
    )[0];
    const ids = targetByBomItemId.get(highest.bomItemId) ?? [];
    ids.push(item.id);
    targetByBomItemId.set(highest.bomItemId, ids);
  }

  for (const [bomItemId, ids] of targetByBomItemId) {
    for (const part of chunk(ids, 500)) {
      const res = await prisma.supplyHistoryItem.updateMany({
        where: { id: { in: part } },
        data: { selectedBomItemId: bomItemId },
      });
      selectionsDefaulted += res.count;
    }
  }

  for (const part of chunk(clearIds, 500)) {
    const res = await prisma.supplyHistoryItem.updateMany({
      where: { id: { in: part } },
      data: { selectedBomItemId: null },
    });
    selectionsCleared += res.count;
  }

  return {
    itemsScanned: items.length,
    itemsWithLinks: candidatesByItem.size,
    linksCreated,
    linksRemoved,
    selectionsKept,
    selectionsDefaulted,
    selectionsCleared,
    unmatchedItemCodes,
  };
}
