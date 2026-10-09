import type { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";

/**
 * A stored value counts as present only when it is non-null and not blank.
 * A blank must lose to a derived value, otherwise an empty cell would freeze a
 * good name.
 */
export function present(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v.trim() ? v : undefined;
}

// BOM data lives in FullItem -> Bom -> BomItem -> (RawMaterial | FullItem).
// BomRow is one component of one BOM, flattened to the old VerifyBom row shape.
export type BomRow = {
  bomId: string;
  itemCode: string | null;
  rmItemCode: string | null;
  bomIdType: string | null;
  noUse: string | null;
  availableStock: string | null;
};

const bomRowInclude = {
  fullItem: { select: { itemCode: true } },
  components: {
    orderBy: { createdAt: "asc" },
    select: {
      noUse: true,
      rawMaterial: { select: { erpItemCode: true, availableStock: true } },
      fullItem: { select: { itemCode: true } },
    },
  },
} satisfies Prisma.BomInclude;

async function loadBomRows(where: Prisma.BomWhereInput): Promise<BomRow[]> {
  const boms = await prisma.bom.findMany({
    where,
    include: bomRowInclude,
    orderBy: { bomId: "asc" },
  });
  const rows: BomRow[] = [];
  for (const b of boms) {
    for (const c of b.components) {
      const code =
        c.rawMaterial?.erpItemCode?.trim() || c.fullItem?.itemCode?.trim() || "";
      if (!code) continue; // orphan component row (freed slot), same as /api/bom
      rows.push({
        bomId: b.bomId,
        itemCode: b.fullItem.itemCode,
        rmItemCode: code,
        bomIdType: b.bomIdType,
        noUse: c.noUse,
        availableStock: c.rawMaterial?.availableStock ?? null,
      });
    }
  }
  return rows;
}

/** BOM linkage for one (itemCode, bomId): its type and first raw-material component. */
export async function findBomForItem(
  itemCode: string,
  bomId: string,
): Promise<{ bomId: string; bomIdType: string | null; rmItemCode: string | null } | null> {
  const bom = await prisma.bom.findFirst({
    where: { bomId, fullItem: { itemCode } },
    select: {
      bomId: true,
      bomIdType: true,
      components: {
        where: { rawMaterial: { erpItemCode: { not: null } } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { rawMaterial: { select: { erpItemCode: true } } },
      },
    },
  });
  if (!bom) return null;
  return {
    bomId: bom.bomId,
    bomIdType: bom.bomIdType,
    rmItemCode: bom.components[0]?.rawMaterial?.erpItemCode ?? null,
  };
}

/** Component rows for an item's BOMs, optionally skipping "NO USE" components. */
export async function getBomCandidates(
  itemCode: string,
  opts: { excludeNoUse?: boolean } = {},
): Promise<BomRow[]> {
  const rows = await loadBomRows({ fullItem: { itemCode } });
  return opts.excludeNoUse ? rows.filter((r) => r.noUse !== "NO USE") : rows;
}

// Simple TTL cache for distinct bomIds per itemCode
let cache: Map<string, string[]> = new Map();
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

export function clearVerifyBomCache() {
  cache = new Map();
  cacheAt = 0;
}

export async function getDistinctBomIds(itemCode: string): Promise<string[]> {
  const now = Date.now();
  if (cache.has(itemCode) && now - cacheAt < CACHE_TTL_MS) {
    return cache.get(itemCode) ?? [];
  }
  const rows = await prisma.bom.findMany({
    where: { fullItem: { itemCode } },
    select: { bomId: true },
    orderBy: { bomId: "asc" },
  });
  const ids = rows.map((r) => r.bomId).filter(Boolean);
  // update cache
  cache.set(itemCode, ids);
  cacheAt = now;
  return ids;
}

export async function getBatchDistinctBomIds(itemCodes: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(itemCodes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.bom.findMany({
    where: { fullItem: { itemCode: { in: unique } } },
    select: { bomId: true, fullItem: { select: { itemCode: true } } },
    orderBy: { bomId: "asc" },
  });
  const out = new Map<string, string[]>();
  for (const c of unique) out.set(c, []);
  for (const r of rows) {
    const code = r.fullItem.itemCode;
    if (!code || !r.bomId) continue;
    out.get(code)?.push(r.bomId);
  }
  return out;
}

export type BomUseStatus = "USE" | "NO USE" | null;

type BomRowShape = Pick<BomRow, "itemCode" | "rmItemCode" | "bomIdType">;

function computeBomUseStatus(rows: BomRowShape[]): BomUseStatus {
  if (rows.length === 0) return null;
  const types = new Set<string>();
  for (const r of rows) if (r.bomIdType) types.add(r.bomIdType);
  if (types.size !== 1) return null;
  const type = [...types][0];
  const minRms = type === "3:1" ? 3 : type === "2:1" ? 2 : null;
  if (minRms === null) return null;
  const items = new Set<string>();
  for (const r of rows) if (r.itemCode) items.add(r.itemCode);
  if (items.size !== 1) return null;
  const rms = new Set<string>();
  for (const r of rows) if (r.rmItemCode) rms.add(r.rmItemCode);
  return rms.size === minRms ? "USE" : "NO USE";
}

// Quotation-scoped: bomIds with any component marked "NO USE"
export async function getNoUseBomIdSet(bomIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(bomIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await prisma.bom.findMany({
    where: { bomId: { in: unique }, components: { some: { noUse: "NO USE" } } },
    select: { bomId: true },
  });
  return new Set(rows.map((r) => r.bomId));
}

export type BomRmAvail = {
  qualifies: boolean;
  stock: number;
};

export async function getBomRmAvailBatch(
  bomIds: string[],
): Promise<Map<string, BomRmAvail>> {
  const unique = [...new Set(bomIds.filter(Boolean))];
  const out = new Map<string, BomRmAvail>();
  if (unique.length === 0) return out;
  const rows = await loadBomRows({ bomId: { in: unique } });
  const groups = new Map<string, BomRow[]>();
  for (const r of rows) {
    if (!groups.has(r.bomId)) groups.set(r.bomId, []);
    groups.get(r.bomId)!.push(r);
  }
  for (const id of unique) {
    const group = groups.get(id) ?? [];
    if (group.length === 0) {
      out.set(id, { qualifies: false, stock: 0 });
      continue;
    }
    const status = computeBomUseStatus(group);
    if (status !== "USE") {
      out.set(id, { qualifies: false, stock: 0 });
      continue;
    }
    let stock = 0;
    for (const r of group) {
      const s = parseFloat(String(r.availableStock ?? "").replace(/,/g, ""));
      if (!isNaN(s)) stock += s;
    }
    out.set(id, {
      qualifies: true,
      stock,
    });
  }
  return out;
}

export type RmAvailRow = {
  id: string;
  bomId: string | null;
  orderQty: string | null;
};

export function computeContractReviewRmAvail(
  rows: RmAvailRow[],
  bomAvail: Map<string, BomRmAvail>,
): Map<string, string> {
  const result = new Map<string, string>();
  const groups = new Map<string, RmAvailRow[]>();
  for (const r of rows) {
    if (!r.bomId) continue;
    if (!groups.has(r.bomId)) groups.set(r.bomId, []);
    groups.get(r.bomId)!.push(r);
  }
  for (const [bomId, group] of groups) {
    const avail = bomAvail.get(bomId);
    if (!avail || !avail.qualifies) continue;
    let remaining = avail.stock;
    const sorted = [...group].sort((a, b) => {
      const qa = parseFloat(String(a.orderQty ?? "").replace(/,/g, ""));
      const qb = parseFloat(String(b.orderQty ?? "").replace(/,/g, ""));
      return (isNaN(qa) ? 0 : qa) - (isNaN(qb) ? 0 : qb);
    });
    for (const r of sorted) {
      const qty = parseFloat(String(r.orderQty ?? "").replace(/,/g, ""));
      const n = isNaN(qty) ? 0 : qty;
      if (n <= remaining) {
        result.set(r.id, "SA");
        remaining -= n;
      } else {
        result.set(r.id, "Not available");
      }
    }
  }
  return result;
}

export async function populateAvailableBomIdsForItemId(itemId: string): Promise<string[]> {
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: { erpItemCode: true },
  });
  if (!item?.erpItemCode) {
    await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
    return [];
  }
  const ids = await getDistinctBomIds(item.erpItemCode);
  // Quotation-scoped: exclude NO-USE bomIds so they don't reappear in the dashboard dropdown
  const noUse = await getNoUseBomIdSet(ids);
  const filtered = ids.filter((id) => !noUse.has(id));
  await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: filtered } });
  return filtered;
}

export async function refreshAvailableBomIdsForCodes(itemCodes: string[]): Promise<number> {
  const map = await getBatchDistinctBomIds(itemCodes);
  // Quotation-scoped: exclude NO-USE bomIds per code
  const allBomIds = [...new Set([...map.values()].flat())];
  const noUse = await getNoUseBomIdSet(allBomIds);
  let updated = 0;
  for (const [code, ids] of map) {
    const filtered = ids.filter((id) => !noUse.has(id));
    const res = await prisma.enquiryItem.updateMany({
      where: { erpItemCode: code },
      data: { availableBomIds: filtered },
    });
    updated += res.count;
  }
  return updated;
}

export type ActuatorResolveRow = {
  id: string;
  itemCode: string;
  actuator: string | null;
};

export function normalizeActuatorPart(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function resolveContractReviewBomIdsFromActuator(
  rows: ActuatorResolveRow[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const itemCodes = [...new Set(rows.map((r) => r.itemCode).filter(Boolean))];
  const bomIdsByItem = await getBatchDistinctBomIds(itemCodes);

  const bomIds = [
    ...new Set([...bomIdsByItem.values()].flat()),
  ];
  const vbRows = await loadBomRows({ bomId: { in: bomIds } });
  const rmCodes = [
    ...new Set(vbRows.map((r) => r.rmItemCode).filter((c): c is string => !!c)),
  ];
  const rmItems = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: rmCodes } },
    select: { erpItemCode: true, l7Dimension: true, l6Std: true },
  });
  const rmMap = new Map<string, { l7: string; l6: string }>();
  for (const r of rmItems) {
    if (!r.erpItemCode) continue;
    rmMap.set(r.erpItemCode, {
      l7: normalizeActuatorPart(r.l7Dimension ?? ""),
      l6: normalizeActuatorPart(r.l6Std ?? ""),
    });
  }

  const rmsByBom: Record<string, { l7: string; l6: string }[]> = {};
  for (const v of vbRows) {
    if (!v.rmItemCode) continue;
    const meta = rmMap.get(v.rmItemCode);
    if (!meta) continue;
    if (!rmsByBom[v.bomId]) rmsByBom[v.bomId] = [];
    rmsByBom[v.bomId].push(meta);
  }

  for (const row of rows) {
    if (!row.actuator || !row.actuator.includes("@")) continue;
    const [aRaw, bRaw] = row.actuator.split("@");
    const a = normalizeActuatorPart(aRaw);
    const b = normalizeActuatorPart(bRaw);
    const candidates = bomIdsByItem.get(row.itemCode) ?? [];
    let match: string | null = null;
    let multi = false;
    for (const bomId of candidates) {
      const metas = rmsByBom[bomId] ?? [];
      const isMatch = metas.some(
        (m) =>
          (a === m.l7 && b === m.l6) || (a === m.l6 && b === m.l7),
      );
      if (!isMatch) continue;
      if (match === null) match = bomId;
      else multi = true;
    }
    if (match !== null && !multi) out.set(row.id, match);
  }
  return out;
}
