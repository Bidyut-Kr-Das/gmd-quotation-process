"use server";

import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import {
  buildEnquiryOrderBySql,
  buildEnquiryWhereSql,
  buildItemWhereSql,
  facetExpression,
  FIRST_ITEM_JOIN_SQL,
} from "@/lib/enquiry-query";
import type {
  ClosureCounts,
  EnquiryFacetResult,
  EnquiryPageResult,
  EnquiryQuery,
  EnquirySummary,
  FilteredIds,
} from "@/lib/enquiryQuery";
import {
  getBatchDistinctBomIds,
  getClosedBomIdSet,
  getNoUseBomIdSet,
} from "@/lib/verifyBomLookup";

const MAX_PAGE_SIZE = 500;
const FACET_LIMIT = 500;

function clampPage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

/**
 * One page of the quotation dashboard: filtered/sorted enquiry ids from SQL,
 * then only those enquiries hydrated with their items.
 */
export async function fetchEnquiryPage(
  query: EnquiryQuery,
  includeSummary = true,
): Promise<EnquiryPageResult> {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const offset = (page - 1) * pageSize;

  const where = buildEnquiryWhereSql({ ...query, selectedEnquiryIds: [] });
  const itemWhere = buildItemWhereSql(query);
  // Docket selection scopes the cards and facet options, never the table itself.
  const scopedWhere =
    query.selectedEnquiryIds.length > 0
      ? buildEnquiryWhereSql(query)
      : where;
  const { orderBy, needsFirstItem } = buildEnquiryOrderBySql(query);

  const [idRows, countRows, scopedCountRows, totalRows, itemRows, closureRows] =
    await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM "Enquiry" e
        ${needsFirstItem ? FIRST_ITEM_JOIN_SQL : Prisma.empty}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "Enquiry" e WHERE ${where}
      `,
      includeSummary && query.selectedEnquiryIds.length > 0
        ? prisma.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM "Enquiry" e WHERE ${scopedWhere}
          `
        : Promise.resolve(undefined),
      includeSummary ? prisma.enquiry.count() : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<
            { gst: string | null; excl: string | null; cost: string | null; qty: string | null }[]
          >`
            SELECT i."totalValue" AS gst, i."itemWiseTotalValue" AS excl, i."cost" AS cost, i."quantity" AS qty
            FROM "EnquiryItem" i
            JOIN "Enquiry" e ON e.id = i."enquiryId"
            WHERE ${scopedWhere} AND ${itemWhere}
          `
        : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<{ status: string | null; count: number }[]>`
            SELECT btrim(coalesce(e."closureStatus", '')) AS status, count(*)::int AS count
            FROM "Enquiry" e WHERE ${where}
            GROUP BY 1
          `
        : Promise.resolve(undefined),
    ]);

  const total = Number(countRows[0]?.count ?? 0);
  const ids = idRows.map((r) => r.id);

  let enquiries: EnquiryPageResult["enquiries"] = [];
  if (ids.length > 0) {
    const rows = await prisma.enquiry.findMany({
      where: { id: { in: ids } },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });
    const order = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    // BOM availability / NO-USE / closed lookups, for this page's item codes only.
    let bomMap: Map<string, string[]> = new Map();
    let noUseSet: Set<string> = new Set();
    let closedBomSet: Set<string> = new Set();
    try {
      const codes = [
        ...new Set(
          rows.flatMap((e) =>
            e.items
              .map((i) => i.erpItemCode)
              .filter((c): c is string => !!c && c.trim() !== ""),
          ),
        ),
      ];
      if (codes.length > 0) {
        bomMap = await getBatchDistinctBomIds(codes);
        const bomIds = [...new Set([...bomMap.values()].flat())];
        noUseSet = await getNoUseBomIdSet(bomIds);
        closedBomSet = await getClosedBomIdSet(bomIds);
      }
    } catch (error) {
      console.warn("[enquiryQuery] BOM availability batch failed:", error);
    }

    enquiries = rows.map((enquiry) => ({
      ...enquiry,
      items: enquiry.items.map((item) => {
        const code = item.erpItemCode;
        const availableBomIds = code
          ? (bomMap.get(code) ?? []).filter((id) => !noUseSet.has(id))
          : (item.availableBomIds ?? []);
        const selectedBomId = item.bomId;
        const visibleBomIds = [
          ...new Set([
            ...(availableBomIds ?? []),
            ...(selectedBomId ? [selectedBomId] : []),
          ]),
        ];
        return {
          ...item,
          availableBomIds,
          closedBomIds: visibleBomIds.filter((id) => closedBomSet.has(id)),
          quantity: item.quantity != null ? Number(item.quantity) : 0,
          productCost: item.productCost != null ? Number(item.productCost) : null,
          cost: item.cost != null ? Number(item.cost) : null,
          discount: item.discount != null ? Number(item.discount) : null,
          vaPercent: item.vaPercent != null ? Number(item.vaPercent) : null,
          quotedRate: item.quotedRate || null,
        };
      }),
    }));
  }

  let summary: EnquirySummary | null = null;
  if (includeSummary && itemRows && closureRows) {
    let totalValueGst = 0;
    let totalValueExclGst = 0;
    let totalCost = 0;
    let totalQuantity = 0;
    for (const row of itemRows) {
      const gst = toNumber(row.gst);
      if (gst !== null && gst !== 0) totalValueGst += gst;
      const excl = toNumber(row.excl);
      if (excl !== null && excl !== 0) totalValueExclGst += excl;

      const cost = toNumber(row.cost);
      if (cost !== null && cost > 0) {
        const qty = toNumber(row.qty);
        totalCost += cost * (qty !== null && qty > 0 ? qty : 1);
      }
      const qty = toNumber(row.qty);
      if (qty !== null && qty > 0) totalQuantity += qty;
    }

    const closureCounts: ClosureCounts = {};
    let notSentCount = 0;
    for (const row of closureRows) {
      const status = (row.status ?? "").trim();
      const count = Number(row.count ?? 0);
      if (status === "" || status === "-") {
        notSentCount += count;
        continue;
      }
      closureCounts[status] = (closureCounts[status] ?? 0) + count;
    }

    summary = {
      filteredEnquiries: scopedCountRows ? Number(scopedCountRows[0]?.count ?? 0) : total,
      analyticsItems: itemRows.length,
      totalValueGst,
      totalValueExclGst,
      totalCost,
      totalQuantity,
      closureCounts,
      notSentCount,
      totalEnquiries: totalRows ?? 0,
    };
  }

  return { enquiries, total, summary };
}

/** Distinct values for one cascading dropdown, excluding its own filter. */
export async function fetchEnquiryFacet(
  query: EnquiryQuery,
  field: string,
): Promise<EnquiryFacetResult> {
  const facet = facetExpression(field);
  if (!facet) return { field, options: [] };

  const rows =
    facet.level === "enquiry"
      ? await prisma.$queryRaw<{ value: string | null }[]>`
          SELECT DISTINCT ${facet.expr} AS value
          FROM "Enquiry" e
          WHERE ${buildEnquiryWhereSql(query, { skipField: field })}
            AND EXISTS (
              SELECT 1 FROM "EnquiryItem" i
              WHERE i."enquiryId" = e.id
                AND ${buildItemWhereSql(query, { skipField: field })}
            )
            AND ${facet.expr} IS NOT NULL
          ORDER BY 1
          LIMIT ${FACET_LIMIT + 1}
        `
      : await prisma.$queryRaw<{ value: string | null }[]>`
          SELECT DISTINCT ${facet.expr} AS value
          FROM "EnquiryItem" i
          JOIN "Enquiry" e ON e.id = i."enquiryId"
          WHERE ${buildEnquiryWhereSql(query, { skipField: field })}
            AND ${buildItemWhereSql(query, { skipField: field })}
            AND ${facet.expr} IS NOT NULL
          ORDER BY 1
          LIMIT ${FACET_LIMIT + 1}
        `;

  const options = rows
    .map((r) => (r.value == null ? "" : String(r.value).trim()))
    .filter((v) => v !== "" && v !== "undefined" && v !== "null")
    .slice(0, FACET_LIMIT);
  return { field, options };
}

/** Every enquiry (and item) id matching the filters - for select-all / bulk actions. */
export async function fetchFilteredEnquiryIds(query: EnquiryQuery): Promise<FilteredIds> {
  const tableQuery = { ...query, selectedEnquiryIds: [] };
  const where = buildEnquiryWhereSql(tableQuery);
  const itemWhere = buildItemWhereSql(tableQuery);
  const [enquiryRows, itemRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM "Enquiry" e WHERE ${where}
    `,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM "EnquiryItem" i
      JOIN "Enquiry" e ON e.id = i."enquiryId"
      WHERE ${where} AND ${itemWhere}
    `,
  ]);
  return {
    enquiryIds: enquiryRows.map((r) => r.id),
    itemIds: itemRows.map((r) => r.id),
  };
}

/** Every matching enquiry with its items - used by the Excel export. */
export async function fetchFilteredEnquiryExport(
  query: EnquiryQuery,
): Promise<EnquiryPageResult["enquiries"]> {
  const tableQuery = { ...query, selectedEnquiryIds: [] };
  const where = buildEnquiryWhereSql(tableQuery);
  const { orderBy, needsFirstItem } = buildEnquiryOrderBySql(tableQuery);
  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM "Enquiry" e
    ${needsFirstItem ? FIRST_ITEM_JOIN_SQL : Prisma.empty}
    WHERE ${where}
    ORDER BY ${orderBy}
  `;
  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = await prisma.enquiry.findMany({
    where: { id: { in: ids } },
    include: {
      items: { orderBy: { position: "asc" } },
      attachments: true,
    },
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return rows.map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => ({
      ...item,
      quantity: item.quantity != null ? Number(item.quantity) : 0,
      productCost: item.productCost != null ? Number(item.productCost) : null,
      cost: item.cost != null ? Number(item.cost) : null,
      discount: item.discount != null ? Number(item.discount) : null,
      vaPercent: item.vaPercent != null ? Number(item.vaPercent) : null,
      quotedRate: item.quotedRate || null,
    })),
  }));
}
