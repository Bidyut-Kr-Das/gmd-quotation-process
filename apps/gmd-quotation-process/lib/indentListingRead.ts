import { prisma } from "@/lib/prisma";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { applyTpavSlvMerge } from "./indentListingFamilySum";
import {
  buildContractMetricsByRmCode,
  buildOrderQtyByRmCode,
  buildRowVariantMetrics,
  buildStockByRmCode,
  type VariantMetrics,
} from "./indentListingMetrics";

// rmCodeV1..rmCodeV4 positions in the row shape produced below.
const RM_CODE_IDXS = [13, 14, 15, 16];

export interface MergedIndentListing {
  /** Rows in INDENT_LISTING_HEADERS order, with TPAV+SLV folded into SLV/TPAV. */
  rows: unknown[][];
  /** Ids aligned with `rows`; synthesized rows get a generated id. */
  ids: string[];
  /**
   * Stored-row ids behind each displayed row, aligned with `rows`. A merged row
   * lists its own id plus every contributing `TPAV+SLV` id; a synthesized row
   * lists only its contributing ids. Empty when the row has no stored source.
   */
  sourceIds: string[][];
  /** Per-row, per-variant (V1..V4) metrics aligned with `rows`. */
  metrics: VariantMetrics[][];
  totalRows: number;
  syncedAt: string | null;
}

/**
 * The single read path for the Indent Listing. Reads the stored rows and
 * applies the TPAV+SLV merge (see `lib/indentListingFamilySum.ts`) so every
 * in-app consumer shows the same totals. Nothing is written back to the DB.
 */
export async function getMergedIndentListing(): Promise<MergedIndentListing> {
  const items = await prisma.indentListing.findMany({
    orderBy: { item: "asc" },
  });

  if (items.length === 0) {
    return {
      rows: [],
      ids: [],
      sourceIds: [],
      metrics: [],
      totalRows: 0,
      syncedAt: null,
    };
  }

  const rawRows = items.map((item) => [
    item.item,
    item.size,
    item.pnRating,
    item.mcReceivedPending,
    item.totalBalBillAgCont != null ? String(item.totalBalBillAgCont) : null,
    item.v1,
    item.v2,
    item.v3,
    item.v4,
    item.v1Category,
    item.v2Category,
    item.v3Category,
    item.v4Category,
    item.rmCodeV1,
    item.rmCodeV2,
    item.rmCodeV3,
    item.rmCodeV4,
  ]);

  const { rows, ids, sourceIds } = applyTpavSlvMerge(
    rawRows,
    items.map((i) => i.id),
  );

  // Per-variant metrics for the merged rows. Stock and ORDERED QTY come from
  // the raw-material master (`availableStock` and `orderDelivery`, "Order Qty");
  // the Contract Review quantities are grouped by `costCodeRef`, the RM code
  // published per variant.
  const [rawMaterials, contractRows] = await Promise.all([
    prisma.rawMaterial.findMany({
      select: { erpItemCode: true, availableStock: true, orderDelivery: true },
    }),
    tenderPrisma.contractReview.findMany({
      where: { costCodeRef: { not: null } },
      select: {
        costCodeRef: true,
        mcReceivedPending: true,
        orderQty: true,
        balanceToProdOrd: true,
      },
    }),
  ]);

  const stockByCode = buildStockByRmCode(rawMaterials);
  const orderQtyByCode = buildOrderQtyByRmCode(rawMaterials);
  const contractByCode = buildContractMetricsByRmCode(contractRows);
  const metrics = buildRowVariantMetrics(
    rows,
    RM_CODE_IDXS,
    stockByCode,
    contractByCode,
    orderQtyByCode,
  );

  const lastSynced = items.reduce(
    (latest: Date, item) =>
      item.syncedAt > latest ? item.syncedAt : latest,
    items[0].syncedAt,
  );

  return {
    rows,
    ids,
    sourceIds,
    metrics,
    totalRows: rows.length,
    syncedAt: lastSynced?.toISOString() ?? null,
  };
}
