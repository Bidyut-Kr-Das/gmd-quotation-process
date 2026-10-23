"use server";

import { prisma } from "@/lib/prisma";
import {
  SUPPLY_LATERAL_SQL,
  buildSupplyOrderBy,
  buildSupplyWhere,
  supplyFacetExpression,
  type SupplyQuery,
} from "@/lib/supplyQuery";
import { buildSupplyRow } from "@/lib/supplyRows";

const MAX_PAGE_SIZE = 500;
const FACET_LIMIT = 500;
const EXPORT_BATCH = 500;

function clampPage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

export interface SupplyPageResult {
  rows: unknown[][];
  ids: string[];
  total: number;
  syncedAt: string | null;
  bomIdOptions: Record<string, string[]>;
  utilityOptions: string[];
}

const SUPPLY_INCLUDE = {
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
} as const;

async function hydrateSupplyItems(ids: string[]) {
  if (ids.length === 0) return [];
  const items = await prisma.supplyHistoryItem.findMany({
    where: { id: { in: ids } },
    include: SUPPLY_INCLUDE,
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null);
}

/** One filtered, sorted page of Supply History. */
export async function fetchSupplyPage(
  query: SupplyQuery,
): Promise<SupplyPageResult> {
  const page = clampPage(query.filters.currentPage);
  const pageSize = clampPageSize(query.filters.pageSize);
  const where = buildSupplyWhere(query);
  const orderBy = buildSupplyOrderBy(query);

  const [idRows, countRows, syncedRows, utilityRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "SupplyHistoryItem" s
      ${SUPPLY_LATERAL_SQL}
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM "SupplyHistoryItem" s
      ${SUPPLY_LATERAL_SQL}
      WHERE ${where}
    `,
    prisma.$queryRaw<{ at: Date | null }[]>`
      SELECT max(s."syncedAt") AS at FROM "SupplyHistoryItem" s
    `,
    prisma.lookupOption.findMany({
      where: { type: "UTILITY", isActive: true },
      orderBy: [{ sortOrder: "asc" }],
      select: { value: true },
    }),
  ]);

  const ids = idRows.map((row) => row.id);
  const items = await hydrateSupplyItems(ids);

  const rows: unknown[][] = [];
  const bomIdOptions: Record<string, string[]> = {};
  for (const item of items) {
    const built = buildSupplyRow(item);
    rows.push(built.row);
    bomIdOptions[item.id] = built.bomIdOptions;
  }

  const utilityOptions = utilityRows
    .map((row) => row.value)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    rows,
    ids,
    total: Number(countRows[0]?.count ?? 0),
    syncedAt: syncedRows[0]?.at ? new Date(syncedRows[0].at).toISOString() : null,
    bomIdOptions,
    utilityOptions,
  };
}

/** Distinct, cascaded options for one column dropdown. */
export async function fetchSupplyFacet(
  query: SupplyQuery,
  header: string,
): Promise<string[]> {
  const expr = supplyFacetExpression(header);
  if (!expr) return [];

  const where = buildSupplyWhere(query, header);
  const rows = await prisma.$queryRaw<{ value: string | null }[]>`
    SELECT DISTINCT ${expr} AS value
    FROM "SupplyHistoryItem" s
    ${SUPPLY_LATERAL_SQL}
    WHERE ${where} AND btrim(${expr}) <> ''
    ORDER BY 1
    LIMIT ${FACET_LIMIT + 1}
  `;

  return rows
    .map((row) => (row.value == null ? "" : String(row.value).trim()))
    .filter((value) => value !== "")
    .slice(0, FACET_LIMIT);
}

/** Every matching row, for the Excel export. */
export async function fetchAllSupplyRows(
  query: SupplyQuery,
): Promise<unknown[][]> {
  const where = buildSupplyWhere(query);
  const orderBy = buildSupplyOrderBy(query);
  const ids = (
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "SupplyHistoryItem" s
      ${SUPPLY_LATERAL_SQL}
      WHERE ${where}
      ORDER BY ${orderBy}
    `
  ).map((row) => row.id);

  const rows: unknown[][] = [];
  for (let i = 0; i < ids.length; i += EXPORT_BATCH) {
    const items = await hydrateSupplyItems(ids.slice(i, i + EXPORT_BATCH));
    for (const item of items) rows.push(buildSupplyRow(item).row);
  }
  return rows;
}
