import { prisma } from "@/lib/prisma";
import { neonPrisma } from "@/lib/neonPrisma";

/**
 * Derived Cost / BOM ID for a Physical Stock ERP code.
 *
 * The "highest cost" is NOT recomputed here: the database triggers keep
 * `FullItem.cost = MAX(BomItem.cost)` across the BOMs a full item owns
 * (see prisma/migrations/20261011130000_rebuild_bom_cost_triggers). We only
 * read that value back through the BOM relation.
 */
export interface PhysicalStockDerivation {
  /** Every candidate BOM id for the code, ascending. */
  bomIds: string[];
  /** Highest-cost BOM id (the default selection), or null when there is none. */
  defaultBomId: string | null;
  /** Effective cost per candidate BOM: owning FullItem.cost, else the code's RawMaterial.cost. */
  costByBom: Record<string, string | null>;
  /** Cost when there are no candidate BOMs: the code's FullItem.cost, else RawMaterial.cost. */
  fallbackCost: string | null;
  /** Max cost across candidates (or fallbackCost when there are none). */
  maxCost: string | null;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

function toNum(v: unknown): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function toCostString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Candidate BOMs for a code = union of:
 *   - BOMs owned by the FullItem whose itemCode = code
 *   - BOMs that consume the code as a component (BomItem.rawMaterial / fullItem)
 *
 * Each candidate's cost = its owning `Bom.fullItem.cost` (already the DB-max),
 * falling back to the code's `RawMaterial.cost`. Highest wins.
 */
export async function derivePhysicalStockByCodes(
  codes: string[],
): Promise<Map<string, PhysicalStockDerivation>> {
  const out = new Map<string, PhysicalStockDerivation>();
  const unique = [...new Set(codes.map(norm).filter(Boolean))];
  if (unique.length === 0) return out;

  const codeFilter = { in: unique, mode: "insensitive" as const };

  // Cost fallbacks keyed by normalized code.
  const [rawMaterials, fullItems] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { erpItemCode: codeFilter },
      select: { erpItemCode: true, cost: true },
    }),
    prisma.fullItem.findMany({
      where: { itemCode: codeFilter },
      select: { itemCode: true, cost: true },
    }),
  ]);

  const rmCostByCode = new Map<string, string>();
  for (const rm of rawMaterials) {
    const code = norm(rm.erpItemCode);
    const cost = toCostString(rm.cost);
    if (code && cost !== null) rmCostByCode.set(code, cost);
  }
  const fullItemCostByCode = new Map<string, string>();
  for (const fi of fullItems) {
    const code = norm(fi.itemCode);
    const cost = toCostString(fi.cost);
    if (code && cost !== null) fullItemCostByCode.set(code, cost);
  }

  // code -> (bomId -> owning FullItem.cost)
  const bomsByCode = new Map<string, Map<string, string | null>>();
  const addCandidate = (code: string, bomId: string, ownerCost: string | null) => {
    if (!code || !bomId) return;
    let m = bomsByCode.get(code);
    if (!m) {
      m = new Map();
      bomsByCode.set(code, m);
    }
    if (!m.has(bomId)) m.set(bomId, ownerCost);
  };

  // (a) FullItem side.
  const ownedBoms = await prisma.bom.findMany({
    where: { fullItem: { itemCode: codeFilter } },
    select: {
      bomId: true,
      fullItem: { select: { itemCode: true, cost: true } },
    },
  });
  for (const bom of ownedBoms) {
    addCandidate(
      norm(bom.fullItem?.itemCode),
      bom.bomId,
      toCostString(bom.fullItem?.cost),
    );
  }

  // (b) Component side (raw material / full item consumed by a BOM).
  const componentItems = await prisma.bomItem.findMany({
    where: {
      OR: [
        { rawMaterial: { erpItemCode: codeFilter } },
        { fullItem: { itemCode: codeFilter } },
      ],
    },
    select: {
      bom: {
        select: {
          bomId: true,
          fullItem: { select: { cost: true } },
        },
      },
      rawMaterial: { select: { erpItemCode: true } },
      fullItem: { select: { itemCode: true } },
    },
  });
  for (const item of componentItems) {
    const bomId = item.bom?.bomId;
    if (!bomId) continue;
    const ownerCost = toCostString(item.bom?.fullItem?.cost);
    const rmCode = norm(item.rawMaterial?.erpItemCode);
    const fiCode = norm(item.fullItem?.itemCode);
    if (rmCode) addCandidate(rmCode, bomId, ownerCost);
    if (fiCode) addCandidate(fiCode, bomId, ownerCost);
  }

  for (const code of unique) {
    const candidates = bomsByCode.get(code);
    const fallbackCost =
      rmCostByCode.get(code) ?? fullItemCostByCode.get(code) ?? null;

    const bomIds = candidates ? [...candidates.keys()].sort() : [];
    const costByBom: Record<string, string | null> = {};
    let defaultBomId: string | null = null;
    let maxCost: string | null = fallbackCost;
    let maxValue = fallbackCost !== null ? (toNum(fallbackCost) ?? -Infinity) : -Infinity;

    for (const bomId of bomIds) {
      const effective = candidates!.get(bomId) ?? fallbackCost;
      costByBom[bomId] = effective;
      const value = toNum(effective);
      if (value !== null && value > maxValue) {
        maxValue = value;
        maxCost = effective;
        defaultBomId = bomId;
      }
    }

    // No costed candidate: keep the first BOM as the default so the dropdown
    // still shows a selection, but leave cost at the code-level fallback.
    if (defaultBomId === null && bomIds.length > 0) {
      defaultBomId = bomIds[0];
    }

    out.set(code, { bomIds, defaultBomId, costByBom, fallbackCost, maxCost });
  }

  return out;
}

/** Effective cost for one (code, bomId): owning FullItem.cost, else RawMaterial.cost. */
export async function costForPhysicalStockBom(
  code: string,
  bomId: string,
): Promise<string | null> {
  const c = norm(code);
  const bom = await prisma.bom.findFirst({
    where: { bomId },
    select: { fullItem: { select: { cost: true } } },
  });
  const ownerCost = toCostString(bom?.fullItem?.cost);
  if (ownerCost !== null) return ownerCost;
  if (!c) return null;
  const rm = await prisma.rawMaterial.findFirst({
    where: { erpItemCode: { equals: c, mode: "insensitive" } },
    select: { cost: true },
  });
  return toCostString(rm?.cost);
}

/**
 * Recompute `cost` / `bom_id` for every Physical Stock row. An existing
 * `bom_id` is preserved as long as it is still a valid candidate; otherwise the
 * highest-cost BOM becomes the default. Always refreshes `cost`.
 *
 * Cross-database: the BOM graph (FullItem/RawMaterial/Bom/BomItem) is read from
 * the LOCAL database while the results are written to the Neon PhysicalStock
 * table. There is no shared transaction, so a mid-run failure leaves a partial
 * update; the operation is idempotent and safe to re-run.
 */
export async function applyPhysicalStockDerivations(): Promise<{
  scanned: number;
  updated: number;
}> {
  const rows = await neonPrisma.physicalStock.findMany({
    select: { id: true, erp_code: true, cost: true, bom_id: true },
  });
  const codeSet = [...new Set(rows.map((r) => norm(r.erp_code)).filter(Boolean))];
  const derivations = await derivePhysicalStockByCodes(codeSet);

  const updates: ReturnType<typeof neonPrisma.physicalStock.update>[] = [];
  for (const row of rows) {
    const code = norm(row.erp_code);
    const d = derivations.get(code);

    let nextCost: string | null = null;
    let nextBomId: string | null = null;

    if (d) {
      const keepExisting =
        !!row.bom_id && d.bomIds.includes(row.bom_id);
      nextBomId = keepExisting ? row.bom_id : d.defaultBomId;
      nextCost = nextBomId
        ? (d.costByBom[nextBomId] ?? d.fallbackCost ?? d.maxCost)
        : d.maxCost;
    }

    if (nextCost === row.cost && nextBomId === row.bom_id) continue;
    updates.push(
      neonPrisma.physicalStock.update({
        where: { id: row.id },
        data: { cost: nextCost, bom_id: nextBomId },
      }),
    );
  }

  const chunkSize = 200;
  for (let i = 0; i < updates.length; i += chunkSize) {
    await prisma.$transaction(updates.slice(i, i + chunkSize));
  }

  return { scanned: rows.length, updated: updates.length };
}
