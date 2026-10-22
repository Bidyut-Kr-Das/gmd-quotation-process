"use server";

import { prisma } from "@/lib/prisma";
import type { FlatRow } from "@/lib/tender-flatten";
import {
  buildColumns,
  loadTypeTestsForBatch,
  TENDER_ROW_INCLUDE,
  toFlatRow,
} from "@/lib/tender-rows";
import {
  AI_YES,
  APM_YES,
  buildOrderBySql,
  buildWhereSql,
  columnValueSql,
  HAS_ANY_ASSOCIATION,
  needsFacetQuery,
  type TenderQuery,
} from "@/lib/tender-query";

const MAX_PAGE_SIZE = 2000;

export interface TenderPageResult {
  rows: FlatRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Only returned when the caller asks for meta - these never change per page. */
  columns?: string[];
  associations?: { id: number; name: string; email: string }[];
}

function clampPageSize(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.trunc(n));
}

async function loadPage(
  query: TenderQuery,
  includeMeta: boolean,
): Promise<TenderPageResult> {
  const where = buildWhereSql(query);
  const orderBy = buildOrderBySql(query);
  const pageSize = clampPageSize(query.pageSize);
  const page = clampPage(query.page);

  const [idRows, countRows, associations] = await Promise.all([
    prisma.$queryRaw<{ id: number }[]>`
      SELECT t."id" FROM "tender_merged" t
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "tender_merged" t WHERE ${where}
    `,
    includeMeta
      ? prisma.association.findMany({ select: { id: true, name: true, email: true } })
      : Promise.resolve(undefined),
  ]);

  const total = Number(countRows[0]?.count ?? 0);
  const ids = idRows.map((r) => r.id);

  if (ids.length === 0) {
    // Still hand back the column order, otherwise a filter that matches
    // nothing would leave the table with no headers and no way back.
    let columns: string[] = [];
    if (includeMeta) {
      const sample = await prisma.tenderMerged.findMany({
        take: 1,
        orderBy: { id: "asc" },
        include: TENDER_ROW_INCLUDE,
      });
      columns = buildColumns(sample as unknown as Record<string, unknown>[]);
    }
    return {
      rows: [],
      total,
      page,
      pageSize,
      ...(includeMeta ? { columns, associations } : {}),
    };
  }

  const batch = await prisma.tenderMerged.findMany({
    where: { id: { in: ids } },
    include: TENDER_ROW_INCLUDE,
  });

  // findMany ignores the id order, so restore the order the SQL page produced.
  const byId = new Map(batch.map((t) => [t.id, t]));
  const ordered = ids.map((id) => byId.get(id)).filter((t) => t != null);

  const typeTests = await loadTypeTestsForBatch(ordered);
  const rows = ordered.map((t) =>
    toFlatRow(t as unknown as Parameters<typeof toFlatRow>[0], typeTests),
  );

  return {
    rows,
    total,
    page,
    pageSize,
    ...(includeMeta
      ? {
          columns: buildColumns(ordered as unknown as Record<string, unknown>[]),
          associations,
        }
      : {}),
  };
}

/**
 * One page of /tenders, filtered and sorted in Postgres.
 *
 * Pass includeMeta on the first call of a session to also get the column order
 * and the association list; both are stable, so later pages skip them.
 */
export async function fetchTendersPage(
  query: TenderQuery,
  includeMeta: boolean,
): Promise<TenderPageResult> {
  return loadPage(query, includeMeta);
}

export interface TenderFacetResult {
  column: string;
  options: string[];
  /** True when the column has more distinct values than the dropdown shows. */
  overLimit: boolean;
}

const FACET_LIMIT = 500;

/**
 * Distinct values for one column under every *other* active filter - what
 * makes the dropdowns cascade the way the in-memory version did.
 */
export async function fetchTenderFacet(
  query: TenderQuery,
  column: string,
): Promise<TenderFacetResult> {
    // Columns whose options are hardcoded (Available / Not Available, Yes /
    // No, the association list) never reach the database.
    if (!needsFacetQuery(column, query)) {
      return { column, options: [], overLimit: false };
    }
    const expr = columnValueSql(column, query);
    if (!expr) return { column, options: [], overLimit: false };

    const where = buildWhereSql(query, { skipColumn: column });
    const rows = await prisma.$queryRaw<{ value: string | null }[]>`
      SELECT DISTINCT ${expr} AS value
      FROM "tender_merged" t
      WHERE ${where}
      ORDER BY 1
      LIMIT ${FACET_LIMIT + 1}
    `;
    const options = rows
      .map((r) => r.value)
      .filter((v): v is string => v != null && v !== "");
    return {
      column,
      options: options.slice(0, FACET_LIMIT),
      overLimit: rows.length > FACET_LIMIT,
    };
}

export interface TenderSummary {
  aiYes: number;
  aiYesUnallocated: number;
  apmYesAllocated: number;
  apmYesUnallocated: number;
  personCounts: { id: number; count: number }[];
}

/**
 * The sidebar card counts, over the whole filtered set rather than the page.
 * Uses the same where clause as the page query, so the numbers always agree
 * with what paging through the table would show.
 */
export async function fetchTenderSummary(query: TenderQuery): Promise<TenderSummary> {
    const where = buildWhereSql(query);

    const [totals, perPerson] = await Promise.all([
      prisma.$queryRaw<
        {
          ai_yes: bigint;
          ai_yes_unallocated: bigint;
          apm_yes_allocated: bigint;
          apm_yes_unallocated: bigint;
        }[]
      >`
        SELECT
          count(*) FILTER (WHERE ${AI_YES}) AS ai_yes,
          count(*) FILTER (WHERE ${AI_YES} AND NOT ${HAS_ANY_ASSOCIATION}) AS ai_yes_unallocated,
          count(*) FILTER (WHERE ${APM_YES} AND ${HAS_ANY_ASSOCIATION}) AS apm_yes_allocated,
          count(*) FILTER (WHERE ${APM_YES} AND NOT ${HAS_ANY_ASSOCIATION}) AS apm_yes_unallocated
        FROM "tender_merged" t
        WHERE ${where}
      `,
      prisma.$queryRaw<{ id: number; count: bigint }[]>`
        SELECT ta."associationId" AS id, count(DISTINCT t."id") AS count
        FROM "tender_merged" t
        JOIN "tender_associations" ta ON ta."tenderMergedId" = t."id"
        WHERE ${where}
        GROUP BY 1
      `,
    ]);

    const row = totals[0];
    return {
      aiYes: Number(row?.ai_yes ?? 0),
      aiYesUnallocated: Number(row?.ai_yes_unallocated ?? 0),
      apmYesAllocated: Number(row?.apm_yes_allocated ?? 0),
      apmYesUnallocated: Number(row?.apm_yes_unallocated ?? 0),
      personCounts: perPerson.map((p) => ({ id: p.id, count: Number(p.count) })),
    };
}

const FULL_SCAN_BATCH = 1000;

/**
 * Every row in the filtered set, not just the page. Used by the Excel export
 * and the bulk AI analysis, both of which operate on everything the filters
 * match.
 *
 * Pass `columns` to narrow what comes back - a full export of ~150 columns
 * across the whole table is a lot of strings to ship to a browser.
 *
 * ponytail: the result still materialises in the client's heap. If exporting
 * an unfiltered table becomes slow, move the xlsx generation to a route
 * handler that streams the file instead.
 */
export async function fetchAllFilteredTenderRows(
  query: TenderQuery,
  columns: string[] | null,
): Promise<FlatRow[]> {
    const where = buildWhereSql(query);
    const orderBy = buildOrderBySql(query);

    const idRows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT t."id" FROM "tender_merged" t WHERE ${where} ORDER BY ${orderBy}
    `;
    const ids = idRows.map((r) => r.id);
    const keep = columns && columns.length > 0 ? new Set([...columns, "type", "id"]) : null;

    const out: FlatRow[] = [];
    for (let i = 0; i < ids.length; i += FULL_SCAN_BATCH) {
      const slice = ids.slice(i, i + FULL_SCAN_BATCH);
      const batch = await prisma.tenderMerged.findMany({
        where: { id: { in: slice } },
        include: TENDER_ROW_INCLUDE,
      });
      const byId = new Map(batch.map((t) => [t.id, t]));
      const ordered = slice.map((id) => byId.get(id)).filter((t) => t != null);
      const typeTests = await loadTypeTestsForBatch(ordered);
      for (const t of ordered) {
        const flat = toFlatRow(t as unknown as Parameters<typeof toFlatRow>[0], typeTests);
        if (!keep) {
          out.push(flat);
          continue;
        }
        const narrowed: FlatRow = { type: flat.type, id: flat.id };
        for (const c of keep) {
          if (flat[c] !== undefined) narrowed[c] = flat[c];
        }
        out.push(narrowed);
      }
    }
    return out;
}
