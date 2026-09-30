import { prisma } from "@/lib/prisma";

export type VerifyBomCandidate = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  bomIdType: string | null;
  bomItemQty: string | null;
};

/**
 * A stored value counts as present only when it is non-null and not blank.
 *
 * Both the recompute (which writes VerifyBom) and GET /api/bom (which renders
 * the grid) resolve itemName / rmItemName with this, so the value that is
 * persisted and the value that is displayed can never disagree. A blank must
 * lose to a derived value, otherwise an empty cell would freeze a good name.
 */
export function present(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v.trim() ? v : undefined;
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
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode },
    select: { bomId: true },
    distinct: ["bomId"],
    orderBy: { bomId: "asc" },
  });
  const ids = rows.map((r) => r.bomId).filter(Boolean) as string[];
  // update cache
  cache.set(itemCode, ids);
  cacheAt = now;
  return ids;
}

export async function getCandidates(itemCode: string): Promise<VerifyBomCandidate[]> {
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode },
    orderBy: { bomId: "asc" },
  });
  return rows;
}

export async function getBatchDistinctBomIds(itemCodes: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(itemCodes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode: { in: unique } },
    select: { itemCode: true, bomId: true },
    orderBy: [{ itemCode: "asc" }, { bomId: "asc" }],
  });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.itemCode || !r.bomId) continue;
    if (!map.has(r.itemCode)) map.set(r.itemCode, new Set());
    map.get(r.itemCode)!.add(r.bomId);
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of map) out.set(k, Array.from(set));
  // also ensure codes with 0 entries map to []
  for (const c of unique) if (!out.has(c)) out.set(c, []);
  return out;
}

export type BomUseStatus = "USE" | "NO USE" | null;

type BomRowShape = {
  itemCode: string | null;
  rmItemCode: string | null;
  bomIdType: string | null;
};

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

export async function getBomUseStatus(bomId: string): Promise<BomUseStatus> {
  const rows = await prisma.verifyBom.findMany({
    where: { bomId },
    select: { itemCode: true, rmItemCode: true, bomIdType: true },
  });
  return computeBomUseStatus(rows);
}

// Quotation-scoped: distinct bomIds whose stored VerifyBom.noUse == "NO USE"
export async function getNoUseBomIdSet(bomIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(bomIds.filter(Boolean))];
  const set = new Set<string>();
  if (unique.length === 0) return set;
  const rows = await prisma.verifyBom.findMany({
    where: { bomId: { in: unique }, noUse: "NO USE" },
    select: { bomId: true },
    distinct: ["bomId"],
  });
  for (const r of rows) if (r.bomId) set.add(r.bomId);
  return set;
}

export async function getBomUseStatusBatch(
  bomIds: string[],
): Promise<Map<string, BomUseStatus>> {
  const unique = [...new Set(bomIds.filter(Boolean))];
  const out = new Map<string, BomUseStatus>();
  if (unique.length === 0) return out;
  const rows = await prisma.verifyBom.findMany({
    where: { bomId: { in: unique } },
    select: { bomId: true, itemCode: true, rmItemCode: true, bomIdType: true },
  });
  const groups = new Map<string, BomRowShape[]>();
  for (const r of rows) {
    if (!r.bomId) continue;
    if (!groups.has(r.bomId)) groups.set(r.bomId, []);
    groups.get(r.bomId)!.push(r);
  }
  for (const id of unique) {
    out.set(id, computeBomUseStatus(groups.get(id) ?? []));
  }
  return out;
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
  const rows = await prisma.verifyBom.findMany({
    where: { bomId: { in: unique } },
    select: {
      bomId: true,
      itemCode: true,
      rmItemCode: true,
      bomIdType: true,
      availableStock: true,
    },
  });
  const groups = new Map<
    string,
    (BomRowShape & { availableStock: string | null })[]
  >();
  for (const r of rows) {
    if (!r.bomId) continue;
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

export async function recomputeVerifyBomValues(): Promise<{
  updated: number;
  statusMap: Map<string, BomUseStatus>;
  stockMap: Map<string, string>;
  rmNameMap: Map<string, string | null>;
  itemNameMap: Map<string, string>;
  costMap: Map<string, string>;
}> {
  const items = await prisma.verifyBom.findMany({
    select: {
      id: true,
      bomId: true,
      itemCode: true,
      rmItemCode: true,
      noUse: true,
      availableStock: true,
      cost: true,
      itemName: true,
      rmItemName: true,
    },
  });

  const bomIds = [
    ...new Set(items.map((i) => i.bomId).filter((b): b is string => !!b)),
  ];
  // USE/NO USE is now authoritative from the stored TO_DATE mark; do NOT recompute
  // from bomIdType + RM count (that would revert the TO_DATE "NO USE" marks on /bom).
  // const statusMap = await getBomUseStatusBatch(bomIds);
  const statusMap = new Map<string, BomUseStatus>();

  const itemCodes = [
    ...new Set(items.map((i) => i.itemCode).filter((c): c is string => !!c)),
  ];
  const crRows = await prisma.contractReview.findMany({
    where: { itemCode: { in: itemCodes }, itemName: { not: null } },
    select: { itemCode: true, itemName: true, syncedAt: true },
    orderBy: { syncedAt: "desc" },
  });
  const itemNameMap = new Map<string, string>();
  for (const r of crRows) {
    if (!r.itemCode) continue;
    const name = (r.itemName ?? "").trim();
    if (name && !itemNameMap.has(r.itemCode)) {
      itemNameMap.set(r.itemCode, name);
    }
  }

  const codes = [
    ...new Set(
      items
        .flatMap((i) => [i.rmItemCode, i.itemCode])
        .filter((c): c is string => !!c),
    ),
  ];
  const rawItems = await prisma.gMDUpdateItem.findMany({
    where: {
      OR: [
        { erpItemCode: { in: codes } },
        { bomId: { in: bomIds } },
      ],
    },
    select: {
      erpItemCode: true,
      bomId: true,
      availableStock: true,
      itemNameAuto: true,
      cost: true,
    },
  });

  const stockMap = new Map<string, string>();
  const rmNameMap = new Map<string, string | null>();
  const bomAndItemCodeCostMap = new Map<string, string>();
  const erpCodeCostMap = new Map<string, string>();

  for (const r of rawItems) {
    if (!r.erpItemCode) continue;
    const code = r.erpItemCode.trim().toUpperCase();
    const bId = (r.bomId ?? "").trim().toUpperCase();
    const costVal = (r.cost ?? "").trim();

    if (!stockMap.has(code)) {
      stockMap.set(code, r.availableStock ?? "");
    }
    if (!rmNameMap.has(code)) {
      rmNameMap.set(code, r.itemNameAuto ?? null);
    }
    if (costVal && !erpCodeCostMap.has(code)) {
      erpCodeCostMap.set(code, costVal);
    }
    if (bId && costVal) {
      const key = `${bId}||${code}`;
      if (!bomAndItemCodeCostMap.has(key)) {
        bomAndItemCodeCostMap.set(key, costVal);
      }
    }
  }

  const costMap = new Map<string, string>();
  for (const item of items) {
    const b = (item.bomId ?? "").trim().toUpperCase();
    const itemC = (item.itemCode ?? "").trim().toUpperCase();
    const rmC = (item.rmItemCode ?? "").trim().toUpperCase();

    const derivedCost =
      (b && itemC ? bomAndItemCodeCostMap.get(`${b}||${itemC}`) : null) ??
      (b && rmC ? bomAndItemCodeCostMap.get(`${b}||${rmC}`) : null) ??
      (rmC ? erpCodeCostMap.get(rmC) : null) ??
      (itemC ? erpCodeCostMap.get(itemC) : null) ??
      null;

    if (derivedCost !== null) {
      costMap.set(item.id, derivedCost);
    }
  }

  const updates = items
    .map((item) => {
      const rmKey = (item.rmItemCode ?? "").trim().toUpperCase();
      const liveStock = rmKey ? stockMap.get(rmKey) : undefined;
      // Fall back to the value already stored on VerifyBom (e.g. written by
      // syncNullVerifyBomStockAction) so a known stock is never clobbered with "".
      const stock =
        (liveStock !== undefined && liveStock !== "" ? liveStock : null) ??
        item.availableStock ??
        "";
      // A value already on the row wins. The derived sources
      // (ITEM MASTER ERP via syncBomMastItemNamesAction, else ContractReview /
      // GMDUpdateItem) only fill a gap, so a name is never silently replaced by
      // a different one on every page load.
      const rmItemName = rmKey
        ? (present(item.rmItemName) ?? rmNameMap.get(rmKey) ?? null)
        : null;
      const itemName = item.itemCode
        ? (present(item.itemName) ?? itemNameMap.get(item.itemCode) ?? null)
        : null;
      const cost = costMap.get(item.id) ?? item.cost ?? null;
      return {
        id: item.id,
        stock,
        cost,
        rmItemName,
        itemName,
        oldStock: item.availableStock ?? null,
        oldCost: item.cost ?? null,
        oldRmItemName: item.rmItemName ?? null,
        oldItemName: item.itemName ?? null,
      };
    })
    .filter(
      ({
        stock,
        cost,
        rmItemName,
        itemName,
        oldStock,
        oldCost,
        oldRmItemName,
        oldItemName,
      }) =>
        oldStock !== stock ||
        oldCost !== cost ||
        oldRmItemName !== rmItemName ||
        oldItemName !== itemName,
    )
    .map(({ id, stock, cost, rmItemName, itemName }) =>
      prisma.verifyBom.update({
        where: { id },
        data: { availableStock: stock, cost, rmItemName, itemName },
      }),
    );

  if (updates.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await prisma.$transaction(chunk, { timeout: 20000 });
    }
  }

  return {
    updated: updates.length,
    statusMap,
    stockMap,
    rmNameMap,
    itemNameMap,
    costMap,
  };
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
  const vbRows = await prisma.verifyBom.findMany({
    where: { bomId: { in: bomIds } },
    select: { bomId: true, itemCode: true, rmItemCode: true },
  });
  const rmCodes = [
    ...new Set(vbRows.map((r) => r.rmItemCode).filter(Boolean)),
  ];
  const rmItems = await prisma.gMDUpdateItem.findMany({
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






