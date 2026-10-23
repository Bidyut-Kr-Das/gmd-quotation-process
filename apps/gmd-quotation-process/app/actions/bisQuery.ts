"use server";

import { prisma } from "@/lib/prisma";
import { dbBisStatusToRow } from "@/lib/gmd_lib/bis-status-columns";
import {
  bisFacetExpression,
  buildBisOrderBy,
  buildBisWhere,
  type BisQuery,
} from "@/lib/bisQuery";

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

export interface BisPageResult {
  rows: unknown[][];
  ids: string[];
  total: number;
  syncedAt: string | null;
}

/** One filtered, sorted page of the BIS status table. */
export async function fetchBisPage(query: BisQuery): Promise<BisPageResult> {
  const page = clampPage(query.filters.currentPage);
  const pageSize = clampPageSize(query.filters.pageSize);
  const where = buildBisWhere(query);
  const orderBy = buildBisOrderBy(query);

  const [idRows, countRows, syncedRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT b.id FROM "BisStatus" b
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM "BisStatus" b WHERE ${where}
    `,
    prisma.$queryRaw<{ at: Date | null }[]>`
      SELECT max(b."updatedAt") AS at FROM "BisStatus" b
    `,
  ]);

  const ids = idRows.map((r) => r.id);
  const rows = await hydrateBisRows(ids);

  return {
    rows,
    ids,
    total: Number(countRows[0]?.count ?? 0),
    syncedAt: syncedRows[0]?.at ? new Date(syncedRows[0].at).toISOString() : null,
  };
}

async function hydrateBisRows(ids: string[]): Promise<unknown[][]> {
  if (ids.length === 0) return [];
  const records = await prisma.bisStatus.findMany({
    where: { id: { in: ids } },
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  const rows: unknown[][] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (record) rows.push(dbBisStatusToRow(record));
  }
  return rows;
}

/** Distinct, cascaded options for one column dropdown. */
export async function fetchBisFacet(
  query: BisQuery,
  header: string,
): Promise<string[]> {
  const expr = bisFacetExpression(header);
  if (!expr) return [];

  const where = buildBisWhere(query, header);
  const rows = await prisma.$queryRaw<{ value: string | null }[]>`
    SELECT DISTINCT ${expr} AS value
    FROM "BisStatus" b
    WHERE ${where} AND btrim(${expr}) <> ''
    ORDER BY 1
    LIMIT ${FACET_LIMIT + 1}
  `;

  return rows
    .map((r) => (r.value == null ? "" : String(r.value).trim()))
    .filter((v) => v !== "")
    .slice(0, FACET_LIMIT);
}

/** Every matching row, for the Excel export. */
export async function fetchAllBisRows(query: BisQuery): Promise<unknown[][]> {
  const where = buildBisWhere(query);
  const orderBy = buildBisOrderBy(query);
  const ids = (
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT b.id FROM "BisStatus" b WHERE ${where} ORDER BY ${orderBy}
    `
  ).map((r) => r.id);

  const rows: unknown[][] = [];
  for (let i = 0; i < ids.length; i += EXPORT_BATCH) {
    rows.push(...(await hydrateBisRows(ids.slice(i, i + EXPORT_BATCH))));
  }
  return rows;
}
