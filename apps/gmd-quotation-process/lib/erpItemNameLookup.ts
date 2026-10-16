/**
 * Item-name resolution for a bare ERP item code.
 *
 * The execution-tracking sheet carries `ITEM_CODE` but no item name, and
 * `SupplyHistoryItem.itemName` is `NOT NULL` — and in practice never blank: the
 * table holds **zero** rows with an empty name (measured across all 15,467). So
 * when the sync inserts a row for an item code it has never seen, it needs a real
 * name from somewhere local.
 *
 * Four existing sources already hold one, all keyed by ERP item code, so they are
 * consulted in order of how close they are to a *supply* name:
 *
 *   1. `SupplyHistoryItem.itemName` — the name this item was supplied under
 *      before, most recently. Same shape of data, so it wins.
 *   2. `FullItem.itemName` — the ERP master item name.
 *   3. `RawMaterial.itemNameAuto`, then `itemNameDerived`.
 *   4. `VerifyBom.itemName`.
 *
 * Measured coverage for the 54 codes the FY 2026-27 sheet needs but the DB does
 * not hold: 40 from step 1, nearly all the rest from step 2. A code that none of
 * them knows yields no name, and the caller decides what to do (the sync leaves
 * `itemName` blank and counts it, so the gap is visible instead of invented).
 *
 * Reads only. Nothing here writes, and nothing calls Google.
 */

import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/gmd_lib/execution-tracking-columns";

/** First non-blank name wins, and the map is keyed on the normalised code. */
function putOnce(map: Map<string, string>, code: unknown, name: unknown): void {
  const key = normalizeKey(code);
  const value = String(name ?? "").trim();
  if (!key || !value || map.has(key)) return;
  map.set(key, value);
}

/**
 * Resolves names for the given ERP item codes.
 *
 * Returns a map keyed on the normalised code (`trim` + upper-case). Codes absent
 * from the map have no known name anywhere.
 */
export async function resolveItemNames(
  codes: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = [...new Set(codes.map(normalizeKey).filter(Boolean))];
  if (wanted.length === 0) return map;

  // 1. Supply History — most recent row per code.
  const supplyRows = await prisma.supplyHistoryItem.findMany({
    where: { erpItemCode: { in: wanted }, NOT: { itemName: "" } },
    select: { erpItemCode: true, itemName: true },
    orderBy: { syncedAt: "desc" },
  });
  for (const row of supplyRows) putOnce(map, row.erpItemCode, row.itemName);

  const remaining = () => wanted.filter((code) => !map.has(code));

  // 2. ERP master item name.
  const stillMissingAfterFullItem = remaining();
  if (stillMissingAfterFullItem.length > 0) {
    const fullItems = await prisma.fullItem.findMany({
      where: { itemCode: { in: stillMissingAfterFullItem } },
      select: { itemCode: true, itemName: true },
    });
    for (const row of fullItems) putOnce(map, row.itemCode, row.itemName);
  }

  // 3. Raw material name — auto (ITEM MASTER ERP) first, derived as a fallback.
  const stillMissingAfterRawMaterial = remaining();
  if (stillMissingAfterRawMaterial.length > 0) {
    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: stillMissingAfterRawMaterial } },
      select: { erpItemCode: true, itemNameAuto: true, itemNameDerived: true },
    });
    for (const row of rawMaterials) putOnce(map, row.erpItemCode, row.itemNameAuto);
    for (const row of rawMaterials) putOnce(map, row.erpItemCode, row.itemNameDerived);
  }

  // 4. BOM verification rows.
  const stillMissingAfterVerifyBom = remaining();
  if (stillMissingAfterVerifyBom.length > 0) {
    const verifyRows = await prisma.verifyBom.findMany({
      where: { itemCode: { in: stillMissingAfterVerifyBom } },
      select: { itemCode: true, itemName: true },
    });
    for (const row of verifyRows) putOnce(map, row.itemCode, row.itemName);
  }

  return map;
}

/**
 * The trailing `_` that many ERP master names carry but no other source does:
 * `..._65_PN-10/16_` and `..._65_PN-10/16` are the same description.
 */
export function normalizeMasterName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/[_\s]+$/, "");
}

/**
 * Resolves the **ERP master** description for the given item codes —
 * `FullItem` → `RawMaterial` → `VerifyBom`. `SupplyHistoryItem` is deliberately
 * excluded.
 *
 * This is the description used to decide whether two item codes are really the
 * same product. The master distinguishes `FVC030011` (`..._150_...`) from
 * `FVC030012` (`..._200_...`), while their *stored supply* names can both read
 * `..._200`, because one of them is mislabelled. Measured over the 979 codes that
 * have both: 737 agree, 57 differ only by a trailing `_`, and **185 use a
 * genuinely different vocabulary** — which is why this function is used for
 * *comparison* only, and never to overwrite a stored name wholesale.
 */
export async function resolveMasterNames(
  codes: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = [...new Set(codes.map(normalizeKey).filter(Boolean))];
  if (wanted.length === 0) return map;

  const put = (code: unknown, name: unknown) => {
    const key = normalizeKey(code);
    const value = normalizeMasterName(name);
    if (!key || !value || map.has(key)) return;
    map.set(key, value);
  };

  const fullItems = await prisma.fullItem.findMany({
    where: { itemCode: { in: wanted } },
    select: { itemCode: true, itemName: true },
  });
  for (const row of fullItems) put(row.itemCode, row.itemName);

  const remaining = () => wanted.filter((code) => !map.has(code));

  const afterFullItem = remaining();
  if (afterFullItem.length > 0) {
    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: afterFullItem } },
      select: { erpItemCode: true, itemNameAuto: true, itemNameDerived: true },
    });
    for (const row of rawMaterials) put(row.erpItemCode, row.itemNameAuto);
    for (const row of rawMaterials) put(row.erpItemCode, row.itemNameDerived);
  }

  const afterRawMaterial = remaining();
  if (afterRawMaterial.length > 0) {
    const verifyRows = await prisma.verifyBom.findMany({
      where: { itemCode: { in: afterRawMaterial } },
      select: { itemCode: true, itemName: true },
    });
    for (const row of verifyRows) put(row.itemCode, row.itemName);
  }

  return map;
}
